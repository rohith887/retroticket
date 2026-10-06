"""The first (rule-based, deterministic, explainable) implementation of every engine component.

All domain vocabulary comes from the knowledge pack. Nothing here calls a model, a network or a database.
"""
from __future__ import annotations

import hashlib
import re
from collections import defaultdict

from app.engine import interfaces as I
from app.engine.model import (
    ComponentInfo,
    ConversationInput,
    Fact,
    IntentOutput,
    Mention,
    PendingItem,
    PriorityOutput,
    ProcessedMessage,
    Provenance,
    SentimentOutput,
    StateResult,
)
from app.intelligence import intent as intent_engine
from app.intelligence import priority as priority_engine
from app.intelligence import sentiment as sentiment_engine
from app.intelligence.text import find, phrase_regex
from app.knowledge.loader import KnowledgePack

VERSION = "1.0"
EXTRACTION_VERSION = "0.1"
_NEG_TEXT = re.compile(r"\b(?:not|n't|never|no)\b", re.IGNORECASE)
_LINK_WINDOW = 60  # characters between an entity and the action that belongs to it
_COUNT_WINDOW = 40
_NEGATION_WINDOW = 30
_VERIFIED_EVENT_TYPES = {"ticket_created", "assigned", "unassigned", "status_changed", "priority_changed", "resolved", "reopened"}


# --- sentiment / intent / priority (wrappers over the Phase 1 engines) ---------------------------------------------------
class RulesSentiment(I.SentimentAnalyzer):
    def __init__(self, pack: KnowledgePack):
        self._pack = pack

    @property
    def info(self) -> ComponentInfo:
        return ComponentInfo("rules-sentiment", VERSION)

    def analyze(self, text: str) -> SentimentOutput:
        signals = sentiment_engine.score(text, self._pack.indicators)
        label, confidence = sentiment_engine.decide(signals)
        return SentimentOutput(label, confidence, signals.matched, self.info)


class RulesIntent(I.IntentClassifier):
    def __init__(self, pack: KnowledgePack):
        self._catalog = pack.intents

    @property
    def info(self) -> ComponentInfo:
        return ComponentInfo("rules-intent", VERSION)

    def classify(self, text: str) -> IntentOutput:
        label, confidence, alternatives = intent_engine.classify(text, self._catalog)
        scores = {s.label: s for s in intent_engine.score_all(text, self._catalog)}
        return IntentOutput(label, confidence, tuple(alternatives), scores[label].matched if label in scores else (), self.info)

    def score_sentence(self, text: str) -> tuple[str, int]:
        best = max((s for s in intent_engine.score_all(text, self._catalog) if s.label != self._catalog.fallback.label), key=lambda s: s.score, default=None)
        return (best.label, best.score) if best and best.score > 0 else ("", 0)


class RulesPriority(I.PriorityScorer):
    def __init__(self, pack: KnowledgePack):
        self._indicators = pack.indicators

    @property
    def info(self) -> ComponentInfo:
        return ComponentInfo("rules-priority", VERSION)

    def score(self, text: str, sentiment_label: str | None = None) -> PriorityOutput:
        label, confidence, reasons, found = priority_engine.suggest_with_signals(text, self._indicators, sentiment_label)
        return PriorityOutput(label, confidence, tuple(reasons), tuple((s.group, s.points) for s in found), self.info)


# --- mention extraction ----------------------------------------------------------------------------------------------------
class PhraseMentionExtractor(I.MentionExtractor):
    """Finds knowledge-pack terms (entities, actions or outcomes) in every sentence. Longest match wins on overlap."""

    def __init__(self, pack: KnowledgePack, kind: str):
        self.kind = kind
        if kind == "entity":
            self._entries = [(e.id, e.synonyms, e.type, None) for e in pack.entities.entities]
        elif kind == "action":
            self._entries = [(a.id, a.synonyms, None, None) for a in pack.actions.actions]
        elif kind == "outcome":
            self._entries = [(o.id, o.synonyms, None, o.polarity) for o in pack.outcomes.outcomes]
        else:
            raise ValueError(kind)
        self._patterns = [(entry_id, syn, phrase_regex(syn), etype, polarity) for entry_id, synonyms, etype, polarity in self._entries for syn in synonyms]

    @property
    def info(self) -> ComponentInfo:
        return ComponentInfo(f"rules-{self.kind}-extractor", EXTRACTION_VERSION)

    def extract(self, messages: list[ProcessedMessage]) -> list[Mention]:
        found: list[Mention] = []
        for message in messages:
            for sentence in message.sentences:
                lower = sentence.text.lower()
                candidates = []
                for entry_id, synonym, regex, etype, polarity in self._patterns:
                    for m in regex.finditer(lower):
                        candidates.append((m.end() - m.start(), m.start(), m.end(), entry_id, synonym, etype, polarity))
                taken: list[tuple[int, int]] = []
                for length, start, end, entry_id, synonym, etype, polarity in sorted(candidates, key=lambda c: (-c[0], c[1])):
                    if any(start < t_end and end > t_start for t_start, t_end in taken):
                        continue
                    taken.append((start, end))
                    found.append(Mention(self.kind, entry_id, message.id, sentence.index, sentence.start + start, sentence.start + end, synonym, etype, polarity))
        return sorted(found, key=lambda m: (m.message_id, m.sentence_index, m.start))


# --- facts ---------------------------------------------------------------------------------------------------------------
def _fact_id(*parts) -> str:
    return hashlib.sha1("|".join("" if p is None else str(p) for p in parts).encode()).hexdigest()[:12]


class RulesFactBuilder(I.FactBuilder):
    """Turns mentions into claims (what a party says) and adds verified facts (what the system records).

    Claims link entity, action, outcome, count and polarity inside one sentence, and carry an outcome to an entity in the
    previous sentence of the same message when the sentence points back with a pronoun ("... it was rejected").
    Customer statements are claims. Verified facts come only from the structured ticket data and events supplied by Node.
    """

    def __init__(self, pack: KnowledgePack, intent: I.IntentClassifier):
        self._pack = pack
        self._intent = intent

    @property
    def info(self) -> ComponentInfo:
        return ComponentInfo("rules-facts", EXTRACTION_VERSION)

    def _prov(self, source, message_id, sentence_index, span) -> Provenance:
        return Provenance(source, message_id, sentence_index, span, self.info, self._pack.fingerprint)

    def build(self, conversation: ConversationInput, messages: list[ProcessedMessage], mentions: list[Mention]):
        by_sentence: dict[tuple[str, int], list[Mention]] = defaultdict(list)
        for mention in mentions:
            by_sentence[(mention.message_id, mention.sentence_index)].append(mention)

        facts: list[Fact] = []
        unrecognised = 0
        for message in messages:
            if message.party not in ("customer", "agent", "internal"):
                continue  # automated and system mail is not conversation
            carry: Mention | None = None
            for sentence, features in zip(message.sentences, message.features):
                ms = sorted(by_sentence.get((message.id, sentence.index), []), key=lambda m: m.start)
                entities = [m for m in ms if m.kind == "entity"]
                interpreted = bool(ms) or features.is_question or features.has_request_marker
                if not features.is_question and message.party == "customer":  # 3A: only customer statements become claims
                    facts.extend(self._claims(message, sentence, features, ms, carry))
                if message.party == "customer" and (features.is_question or features.has_request_marker):
                    intent_label, points = self._intent.score_sentence(sentence.text)
                    if points:
                        interpreted = True
                        entity = entities[0] if entities else None
                        facts.append(Fact(_fact_id("req", message.id, sentence.index, intent_label), "claim", "customer", self._prov("message", message.id, sentence.index, (sentence.start, sentence.end)), entity=entity.id if entity else None, entity_type=entity.type if entity else None, request=intent_label))
                if not interpreted and message.party == "customer":
                    unrecognised += 1
                if entities:
                    carry = entities[-1]
        facts.extend(self._verified(conversation))
        return facts, self._pending(messages), unrecognised

    # -- claims
    def _claims(self, message: ProcessedMessage, sentence, features, ms: list[Mention], carry: Mention | None) -> list[Fact]:
        entities = [m for m in ms if m.kind == "entity"]
        actions = [m for m in ms if m.kind == "action"]
        outcomes = [m for m in ms if m.kind == "outcome"]
        linked_by = "same_sentence"
        if not entities:
            if (actions or outcomes) and carry is not None and features.has_pronoun:
                entities = [carry]
                linked_by = "pronoun"
            else:
                return []

        per_entity: dict[int, dict] = {i: {"actions": [], "outcomes": []} for i in range(len(entities))}
        for outcome in outcomes:
            left = [i for i, e in enumerate(entities) if e.start <= outcome.start] if linked_by == "same_sentence" else list(range(len(entities)))
            if left:
                per_entity[max(left, key=lambda i: entities[i].start)]["outcomes"].append(outcome)
        for action in actions:
            def distance(i, a=action):
                e = entities[i]
                return abs(e.start - a.end) if linked_by == "same_sentence" and e.start >= a.end else abs(a.start - e.end) if linked_by == "same_sentence" else 0
            nearest = min(range(len(entities)), key=distance)
            if distance(nearest) <= _LINK_WINDOW:
                per_entity[nearest]["actions"].append(action)

        facts: list[Fact] = []
        for i, entity in enumerate(entities):
            item = per_entity[i]
            if not item["actions"] and not item["outcomes"]:
                continue
            action = min(item["actions"], key=lambda a: abs(a.start - entity.start)) if item["actions"] else None
            targets = item["outcomes"] or [None]
            for outcome in targets:
                involved = [m for m in (entity, action, outcome) if m is not None and linked_by == "same_sentence"] or [m for m in (action, outcome) if m is not None]
                span = (min(m.start for m in involved), max(m.end for m in involved))
                anchor = outcome or action
                count = self._count(features, sentence, anchor, action)
                polarity = self._polarity(features, sentence, anchor)
                facts.append(
                    Fact(
                        _fact_id("claim", message.id, sentence.index, entity.id, action.id if action else None, outcome.id if outcome else None),
                        "claim", message.party, self._prov("message", message.id, sentence.index, span),
                        entity=entity.id, entity_type=entity.type, action=action.id if action else None, outcome=outcome.id if outcome else None,
                        count=count, polarity=polarity, linked_by=linked_by,
                    )
                )
        return facts

    @staticmethod
    def _count(features, sentence, anchor: Mention, action: Mention | None) -> int | None:
        reference = action or anchor
        best, best_distance = None, _COUNT_WINDOW + 1
        for value, start, end in features.counts:
            local_start = reference.start - sentence.start
            local_end = reference.end - sentence.start
            distance = min(abs(start - local_end), abs(local_start - end)) if not (start < local_end and end > local_start) else 0
            if distance < best_distance:
                best, best_distance = value, distance
        return best if best_distance <= _COUNT_WINDOW else None

    @staticmethod
    def _polarity(features, sentence, anchor: Mention) -> str:
        if _NEG_TEXT.search(anchor.matched):
            return "affirmed"  # the term itself already carries the negation ("not accepted")
        local = anchor.start - sentence.start
        return "negated" if any(local - _NEGATION_WINDOW <= n < local for n in features.negations) else "affirmed"

    # -- verified facts (structured data from Node only)
    def _verified(self, conversation: ConversationInput) -> list[Fact]:
        facts = []
        ticket = conversation.ticket
        facts.append(Fact(_fact_id("ver", "status", ticket.status), "verified", "system", self._prov("ticket", None, None, None), field="status", value="resolved" if ticket.is_resolved else ticket.status))
        if ticket.priority:
            facts.append(Fact(_fact_id("ver", "priority", ticket.priority), "verified", "system", self._prov("ticket", None, None, None), field="priority", value=ticket.priority))
        for event in conversation.events:
            if event.type not in _VERIFIED_EVENT_TYPES:
                continue
            value = {"type": event.type}
            for key in ("from", "to"):
                if isinstance(event.data.get(key), str) and len(event.data[key]) <= 40:
                    value[key] = event.data[key]
            facts.append(Fact(_fact_id("ver", "event", event.id), "verified", "system", self._prov("event", event.id, None, None), field="event", value=value))
        return facts

    # -- pending items
    def _pending(self, messages: list[ProcessedMessage]) -> list[PendingItem]:
        indicators = self._pack.indicators
        info_phrases = indicators.phrases("message.information_request") + indicators.optional("message.information_request_extra")
        ack_phrases = indicators.phrases("message.acknowledgement")
        public = [m for m in messages if m.party in ("customer", "agent")]
        pending: list[PendingItem] = []
        for position, message in enumerate(public):
            later = public[position + 1:]
            answered = any(m.party == "agent" for m in later)
            if message.party == "customer":
                flagged = False
                for features in message.features:
                    if features.is_question and not answered:
                        pending.append(PendingItem("unanswered_question", message.id, features.index))
                        flagged = True
                if not flagged and not answered and position == len(public) - 1:
                    marker = next((f for f in message.features if f.has_request_marker), None)
                    if marker is not None:
                        pending.append(PendingItem("unanswered_request", message.id, marker.index))
            else:
                asked_customer = any(m.party == "customer" for m in later)
                for sentence, features in zip(message.sentences, message.features):
                    lower = sentence.text.lower()
                    if not asked_customer and any(find(lower, p) for p in info_phrases):
                        pending.append(PendingItem("information_requested", message.id, features.index))
                        break
                for sentence, features in zip(message.sentences, message.features):
                    lower = sentence.text.lower()
                    if not any(m.party == "agent" for m in later) and any(find(lower, p) for p in ack_phrases):
                        pending.append(PendingItem("support_commitment", message.id, features.index))
                        break
        return pending


# --- state ---------------------------------------------------------------------------------------------------------------
class RulesStateDetector(I.StateDetector):
    """Picks the conversation state with the ordered rules from states.json. If no rule matches: unknown, never a guess."""

    def __init__(self, pack: KnowledgePack):
        self._pack = pack

    @property
    def info(self) -> ComponentInfo:
        return ComponentInfo("rules-state", EXTRACTION_VERSION)

    def detect(self, conversation: ConversationInput, messages: list[ProcessedMessage], facts: list[Fact]) -> StateResult:
        ind = self._pack.indicators
        states = self._pack.states
        resolved_values = {s.value for s in states.resolvedTicketStatuses}
        verified_resolved = conversation.ticket.is_resolved or conversation.ticket.status in resolved_values

        public = [m for m in messages if m.party in ("customer", "agent")]
        last = public[-1] if public else None
        last_signals: list[str] = []
        if last is not None:
            lower = last.text.lower()
            has_problem = any(find(lower, p) for p in ind.phrases("message.problem"))
            requests = {f.provenance.message_id for f in facts if f.request}
            open_request = any(f.is_question or f.has_request_marker for f in last.features) or last.id in requests
            if open_request:
                last_signals.append("open_request")
            if last.party == "agent" and any(find(lower, p) for p in ind.phrases("message.information_request") + ind.optional("message.information_request_extra")):
                last_signals.append("information_request")
            if last.party == "customer" and any(find(lower, p) for p in ind.phrases("message.closing")) and not open_request and not has_problem:
                last_signals.append("closing_only")

        problem_index = -1
        resolution_index = -1
        customer_messages = [(i, m) for i, m in enumerate(public) if m.party == "customer"]
        claim_messages = {f.provenance.message_id for f in facts if f.kind == "claim" and f.party == "customer" and f.outcome and f.polarity == "affirmed" and self._outcome_polarity(f.outcome) == "negative"}
        for i, message in customer_messages:
            lower = message.text.lower()
            if message.id in claim_messages or any(find(lower, p) for p in ind.phrases("message.problem")):
                problem_index = i
            if any(find(lower, p) for p in ind.phrases("message.resolution_claim")):
                resolution_index = i
        unresolved_claims = problem_index >= 0 and resolution_index < problem_index

        actual = {
            "verifiedResolved": verified_resolved,
            "publicMessages": len(public),
            "lastPublicParty": last.party if last else None,
            "lastMessageHas": set(last_signals),
            "unresolvedProblemClaims": unresolved_claims,
        }
        signals = {"verifiedResolved": verified_resolved, "publicMessages": len(public), "lastPublicParty": actual["lastPublicParty"], "lastMessageSignals": last_signals, "unresolvedProblemClaims": unresolved_claims}

        for rule in states.rules:
            if all(self._holds(key, expected, actual) for key, expected in rule.when.items()):
                return StateResult(rule.then, rule.id, rule.justification, rule.review, signals, self.info)
        return StateResult("unknown", None, "No rule matched the available evidence.", None, signals, self.info)

    @staticmethod
    def _holds(key: str, expected, actual) -> bool:
        if key == "lastMessageHas":
            return expected in actual["lastMessageHas"]
        return actual[key] == expected

    def _outcome_polarity(self, outcome_id: str) -> str | None:
        return next((o.polarity for o in self._pack.outcomes.outcomes if o.id == outcome_id), None)
