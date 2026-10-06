"""Deterministic reply drafting (Phase 3C): facts and state in, template sentences out, then a fail-closed validation.

The generator chooses patterns from the reply knowledge (knowledge/replies) and fills them with labels from the knowledge pack.
It restates what the customer CLAIMED ("You mentioned that ...") and what Node recorded (the ticket status); it never confirms
receipt, outcomes, timing or policy. When the context does not support a safe reply it says so instead of guessing.
Internal notes and automated mail never take part: only customer messages since the last agent message are considered.
"""
from __future__ import annotations

import re
from typing import Any

from app.engine import interfaces as I
from app.engine.model import Analysis, ComponentInfo, Fact, ProcessedMessage
from app.engine.realise import Realiser
from app.engine.reply_eligibility import ReplyEligibility
from app.engine.reply_model import ReplyContext, ReplyDraft, ReplySentence, Source
from app.intelligence.text import phrase_regex
from app.knowledge.loader import KnowledgePack
from app.knowledge.reply import ReplyKnowledge

GENERATOR_VERSION = "0.1"
GENERATOR = ComponentInfo("rules-reply", GENERATOR_VERSION)
_STATUS_VALUE = re.compile(r"^[a-z][a-z0-9 -]{0,39}$")


def current_turn(analysis: Analysis) -> list[ProcessedMessage]:
    """Customer messages written since the last agent message: what a reply now has to answer."""
    public = [m for m in analysis.messages if m.party in ("customer", "agent")]
    last_agent = max((i for i, m in enumerate(public) if m.party == "agent"), default=-1)
    return [m for m in public[last_agent + 1:] if m.party == "customer"]


class RulesReplyGenerator(I.ReplyGenerator):
    def __init__(self, pack: KnowledgePack, knowledge: ReplyKnowledge, intent: I.IntentClassifier):
        self._pack = pack
        self._k = knowledge
        self._intent = intent
        self._realiser = Realiser(pack)
        self._ignore = set(knowledge.file.ignoreActions)

    @property
    def info(self) -> ComponentInfo:
        return GENERATOR

    # -- helpers
    def _refuse(self, reason: str, detail: str | None = None, *, intent: str | None = None, state: str | None = None) -> ReplyDraft:
        return ReplyDraft("insufficient_context", GENERATOR, self._k.fingerprint, reason=reason, detail=detail, intent=intent, state=state)

    @staticmethod
    def _fill(template: str, slots: dict[str, str]) -> str:
        return re.sub(r"\s+", " ", template.format(**slots)).replace(" .", ".").strip()

    def _claim_pattern(self, fact: Fact, action: str | None):
        want = {"hasAction": action is not None, "hasOutcome": fact.outcome is not None, "polarity": fact.polarity}
        return next((p for p in self._k.patterns_for("claims") if p.when == want), None)

    def _suppressed_generics(self, entity_ids: list[str]) -> set[str]:
        """Specificity rule: a generic entity (one the ask.which_document pattern lists) is redundant when a specific entity of
        the same type was also named, so passport or marksheet suppresses the generic 'document'. Deterministic; the pack keeps
        both entities."""
        generic_ids = {e for p in self._k.patterns_for("ask_which_document") for e in p.entities}
        kinds = {e.id: e.type for e in self._pack.entities.entities}
        return {g for g in generic_ids if g in entity_ids and any(e not in generic_ids and kinds.get(e) == kinds.get(g) for e in entity_ids)}

    # -- generation
    def generate(self, analysis: Analysis, context: ReplyContext) -> ReplyDraft:
        k = self._k.file
        state = analysis.state.state
        turn = current_turn(analysis)
        if not turn:  # eligibility (ReplyEligibility) normally refuses first; kept so the generator is safe on its own
            return self._refuse("no_customer_message", state=state)

        label = self._intent.classify("\n".join(m.text for m in turn)).label
        if label in k.unknownIntents:
            return self._refuse("unknown_intent", state=state)
        plan = k.intents.get(label)
        if plan is None:
            return self._refuse("unsupported_request", label, intent=label, state=state)

        ids = {m.id for m in turn}
        order = {m.id: i for i, m in enumerate(turn)}
        facts = sorted((f for f in analysis.facts if f.party == "customer" and f.provenance.message_id in ids), key=lambda f: (order[f.provenance.message_id], f.provenance.sentence_index or 0))
        entity_ids = [m.id for m in analysis.mentions if m.kind == "entity" and m.message_id in ids]
        generic = self._suppressed_generics(entity_ids)  # generic entities made redundant by a specific one of the same type

        sentences: list[ReplySentence] = []
        content = 0
        seen: set[str] = set()
        claim_entities: set[str] = set()

        def add(text: str, source: Source, is_content: bool = True) -> None:
            nonlocal content
            if text in seen:
                return
            seen.add(text)
            sentences.append(ReplySentence(text, source))
            content += 1 if is_content else 0

        for step in plan.steps:
            if step in ("opening", "closing"):
                p = self._k.patterns_for(step)[0]
                add(p.template, Source("pattern", p.id), False)
            elif step == "claims":
                taken = 0
                for f in facts:
                    if taken >= k.limits.maxClaims:
                        break
                    if f.kind != "claim" or f.request or not f.entity:
                        continue
                    action = None if f.action in self._ignore else f.action
                    if action is None and f.outcome is None:
                        continue
                    pattern = self._claim_pattern(f, action)
                    if pattern is None:
                        continue
                    slots = self._realiser.slots(f)
                    if action is None:
                        slots["action"] = ""
                    text = self._fill(pattern.template, slots)
                    before = len(sentences)
                    add(text, Source("claim", pattern.id, (f.id,), f.provenance.message_id, f.provenance.sentence_index))
                    if len(sentences) > before:
                        taken += 1
                        claim_entities.add(f.entity)
            elif step == "request_ack":
                p = self._k.patterns_for(step)[0]
                for f in facts:
                    if f.request and f.entity and f.entity not in claim_entities and f.entity not in generic:
                        add(self._fill(p.template, self._realiser.slots(f)), Source("claim", p.id, (f.id,), f.provenance.message_id, f.provenance.sentence_index))
                        break
            elif step == "verified_status":
                p = self._k.patterns_for(step)[0]
                v = next((f for f in analysis.facts if f.kind == "verified" and f.field == "status" and isinstance(f.value, str)), None)
                value = v.value.replace("_", " ").lower() if v else ""
                if v and _STATUS_VALUE.match(value):
                    add(self._fill(p.template, {"value": value}), Source("verified_fact", p.id, (v.id,)))
            elif step == "ask_which_document":
                p = self._k.patterns_for(step)[0]
                if any(e in p.entities and e not in generic for e in entity_ids):
                    add(p.template, Source("pattern", p.id))
            elif step == "ask_missing_entity":
                p = self._k.patterns_for(step)[0]
                if not entity_ids:
                    add(p.template, Source("pattern", p.id))

        if plan.requiresEntity and not entity_ids and not any(s.source.pattern_id.startswith("ask.missing") for s in sentences):
            return self._refuse("missing_entity", label, intent=label, state=state)
        if content == 0:
            return self._refuse("no_safe_pattern", label, intent=label, state=state)

        warnings = []
        if self._k.status == "draft":
            warnings.append("Built from draft reply patterns that have not been approved. Read and edit before sending.")
        if analysis.unrecognised_sentences:
            warnings.append("Some customer sentences could not be interpreted and are not addressed in this draft.")
        return ReplyDraft("ready", GENERATOR, self._k.fingerprint, intent=label, state=state, sentences=tuple(sentences), warnings=tuple(warnings))


# --- validation ---------------------------------------------------------------------------------------------------------------
_DATE = re.compile(r"\b(yesterday|today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december)\b", re.IGNORECASE)
_LINK = re.compile(r"https?:|www\.|@|\.(com|org|net|in|io)\b", re.IGNORECASE)
_MARKER = re.compile(r"\{\{|\}\}|\[\[|\[agent\]|internal|<[a-z/]", re.IGNORECASE)
_WORDS = re.compile(r"[a-z']+")


def _ngrams(text: str, n: int = 4) -> set[tuple[str, ...]]:
    words = _WORDS.findall(text.lower())
    return {tuple(words[i:i + n]) for i in range(len(words) - n + 1)}


class ReplyValidator:
    """Fail closed: every check must pass. Failures name the check and the sentence, never the text."""

    def __init__(self, pack: KnowledgePack, knowledge: ReplyKnowledge):
        self._k = knowledge
        self._pack = pack
        # Every knowledge term (label and synonyms) that could name an entity, action or outcome, so that wording like "approved"
        # is recognised even where it is not a label.
        self._terms: list[tuple[re.Pattern[str], tuple[str, str]]] = []
        for kind, items in (("entity", pack.entities.entities), ("action", pack.actions.actions), ("outcome", pack.outcomes.outcomes)):
            for item in items:
                for term in {item.label.lower(), *item.synonyms}:
                    self._terms.append((phrase_regex(term), (kind, item.id)))
        self._patterns = {p.id: p for p in knowledge.file.patterns}

    def _labels_in(self, text: str) -> set[tuple[str, str]]:
        low = text.lower()
        return {ref for regex, ref in self._terms if regex.search(low)}

    def validate(self, draft: ReplyDraft, analysis: Analysis, context: ReplyContext) -> list[dict[str, Any]]:
        limits = self._k.file.limits
        failures: list[dict[str, Any]] = []

        def fail(check: str, index: int | None = None) -> None:
            failures.append({"check": check, **({"sentenceIndex": index} if index is not None else {})})

        if context.based_on_seq is not None and context.current_seq is not None and context.current_seq > context.based_on_seq:
            fail("stale_context")
        if not draft.sentences or not draft.body.strip():
            fail("empty_draft")
            return failures
        if len(draft.sentences) > limits.maxSentences:
            fail("too_many_sentences")
        if len(draft.body) > limits.maxChars:
            fail("too_long")

        by_id = {f.id: f for f in analysis.facts}
        internal_grams: set[tuple[str, ...]] = set()
        for m in analysis.messages:
            if m.party == "internal":
                internal_grams |= _ngrams(m.text)

        for i, s in enumerate(draft.sentences):
            text, src = s.text, s.source
            if self._k.forbidden.search(text):
                fail("forbidden_phrase", i)
            if re.search(r"\d", text) or _DATE.search(text):
                fail("date_or_number", i)
            if _LINK.search(text):
                fail("link_or_address", i)
            if _MARKER.search(text):
                fail("internal_marker", i)
            if internal_grams and (_ngrams(text) & internal_grams):
                fail("internal_content", i)
            present = self._labels_in(text)
            if src.type == "pattern":
                pattern = self._patterns.get(src.pattern_id)
                if pattern is None or pattern.template != text:
                    fail("pattern_mismatch", i)
                if any(kind in ("outcome", "action") for kind, _ in present):
                    fail("unsupported_outcome", i)
            elif src.type == "claim":
                facts = [by_id.get(fid) for fid in src.fact_ids]
                if not facts or any(f is None or f.kind != "claim" or f.party != "customer" for f in facts):
                    fail("claim_without_claim_fact", i)
                    continue
                if not re.match(r"^You (mentioned|asked)\b", text):
                    fail("claim_not_hedged", i)
                allowed = {(kind, v) for f in facts for kind, v in (("entity", f.entity), ("action", f.action), ("outcome", f.outcome)) if v}
                ignored = {("action", a) for a in self._k.file.ignoreActions}  # words like asked only ever appear in the fixed wording
                if present - allowed - ignored:
                    fail("unsupported_claim", i)
            elif src.type == "verified_fact":
                facts = [by_id.get(fid) for fid in src.fact_ids]
                if not facts or any(f is None or f.kind != "verified" for f in facts):
                    fail("verified_without_verified_fact", i)
                    continue
                if not any(isinstance(f.value, str) and f.value.replace("_", " ").lower() in text.lower() for f in facts):
                    fail("verified_value_mismatch", i)
                own = set().union(*(self._labels_in(str(f.value).replace("_", " ")) for f in facts))
                if present - own:  # a status that is itself a knowledge word (for example pending) is the fact, not an extra claim
                    fail("unsupported_claim", i)
            else:
                fail("missing_source", i)
        if draft.status == "ready" and draft.body != " ".join(s.text for s in draft.sentences):
            fail("body_mismatch")
        return failures


class ReplyService:
    """Generate, then validate. A draft that fails validation is never returned as usable."""

    def __init__(self, generator: I.ReplyGenerator, validator: ReplyValidator, knowledge: ReplyKnowledge):
        self.generator = generator
        self.validator = validator
        self.knowledge = knowledge
        self.eligibility = ReplyEligibility(knowledge)

    def run(self, analysis: Analysis, context: ReplyContext) -> ReplyDraft:
        try:
            turn = current_turn(analysis)
            gate = self.eligibility.check(analysis, bool(turn))
            if not gate.eligible:
                return ReplyDraft("insufficient_context", self.generator.info, self.knowledge.fingerprint, reason=gate.reason, detail=gate.detail, state=gate.state)
            draft = self.generator.generate(analysis, context)
            if draft.status != "ready":
                return draft
            failures = self.validator.validate(draft, analysis, context)
        except Exception:  # noqa: BLE001 - fail closed: an unexpected error is a validation failure, never a draft
            return ReplyDraft("validation_failed", GENERATOR, self.knowledge.fingerprint, failures=({"check": "validator_error"},))
        if failures:
            return ReplyDraft("validation_failed", draft.generator, draft.knowledge, intent=draft.intent, state=draft.state, failures=tuple(failures))
        return draft
