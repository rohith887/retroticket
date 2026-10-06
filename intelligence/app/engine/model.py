"""Data model of the intelligence engine: input, processing stages, facts and the final analysis.

Facts never carry raw customer text. They carry knowledge ids (entity, action, outcome), a count, a polarity, and provenance:
which message and sentence, which character span, which component and version extracted it. A customer's statement is a
CLAIM; only structured information supplied by Node (ticket status and priority, recorded events) is a VERIFIED fact.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Party = Literal["customer", "agent", "internal", "system", "automated"]
FactKind = Literal["claim", "verified"]
Polarity = Literal["affirmed", "negated"]

ROLE_TO_PARTY: dict[str, str] = {"customer": "customer", "agent": "agent", "internal_note": "internal", "system": "system"}


@dataclass(frozen=True)
class ComponentInfo:
    name: str
    version: str

    def to_dict(self) -> dict[str, str]:
        return {"name": self.name, "version": self.version}


# --- input -----------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class InputMessage:
    id: str
    role: str  # customer | agent | internal_note | system
    text: str
    at: str | None = None


@dataclass(frozen=True)
class SystemEvent:
    id: str
    type: str
    at: str | None = None
    data: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class TicketInput:
    status: str
    priority: str | None = None
    is_resolved: bool = False


@dataclass(frozen=True)
class ConversationInput:
    ticket: TicketInput
    messages: tuple[InputMessage, ...]
    events: tuple[SystemEvent, ...] = ()
    ticket_id: str | None = None


# --- processing ------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Sentence:
    message_id: str
    index: int
    start: int
    end: int
    text: str  # in memory only while the analysis runs; never part of a fact or of the output


@dataclass(frozen=True)
class SentenceFeatures:
    message_id: str
    index: int
    is_question: bool
    has_request_marker: bool
    has_pronoun: bool
    tokens: int
    counts: tuple[tuple[int, int, int], ...]  # (value, start, end) of count phrases such as "three times"
    negations: tuple[int, ...]  # start offsets of negation cues


@dataclass(frozen=True)
class ProcessedMessage:
    id: str
    party: str
    text: str  # cleaned and redacted
    sentences: tuple[Sentence, ...]
    features: tuple[SentenceFeatures, ...]
    automated_reason: str | None  # the knowledge phrase that marked it as system-generated, if any
    redactions: int
    at: str | None = None


@dataclass(frozen=True)
class Mention:
    kind: Literal["entity", "action", "outcome"]
    id: str
    message_id: str
    sentence_index: int
    start: int
    end: int
    matched: str  # the knowledge synonym that matched (a pack phrase, not free text)
    type: str | None = None  # entity type
    polarity: str | None = None  # outcome polarity from the pack


@dataclass(frozen=True)
class Provenance:
    source: Literal["message", "ticket", "event"]
    message_id: str | None
    sentence_index: int | None
    span: tuple[int, int] | None
    extracted_by: ComponentInfo
    knowledge: str  # pack fingerprint

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "messageId": self.message_id,
            "sentenceIndex": self.sentence_index,
            "span": list(self.span) if self.span else None,
            "extractedBy": self.extracted_by.to_dict(),
            "knowledge": self.knowledge,
        }


@dataclass(frozen=True)
class Fact:
    id: str
    kind: FactKind
    party: str
    provenance: Provenance
    entity: str | None = None
    entity_type: str | None = None
    action: str | None = None
    outcome: str | None = None
    count: int | None = None
    polarity: str = "affirmed"
    request: str | None = None  # intent label of a customer request
    field: str | None = None  # verified: status | priority | event
    value: Any = None  # verified value
    linked_by: str | None = None  # how outcome/action were attached: same_sentence | previous_sentence | pronoun

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"id": self.id, "kind": self.kind, "party": self.party, "polarity": self.polarity, "provenance": self.provenance.to_dict()}
        for key, value in (("entity", self.entity), ("entityType", self.entity_type), ("action", self.action), ("outcome", self.outcome), ("count", self.count), ("request", self.request), ("field", self.field), ("value", self.value), ("linkedBy", self.linked_by)):
            if value is not None:
                out[key] = value
        return out


@dataclass(frozen=True)
class PendingItem:
    kind: Literal["unanswered_question", "information_requested", "support_commitment", "unanswered_request"]
    message_id: str
    sentence_index: int | None

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "messageId": self.message_id, "sentenceIndex": self.sentence_index}


@dataclass(frozen=True)
class StateResult:
    state: str
    rule_id: str | None
    justification: str
    rule_review: str | None
    signals: dict[str, Any]
    component: ComponentInfo

    def to_dict(self) -> dict[str, Any]:
        return {"state": self.state, "ruleId": self.rule_id, "ruleReview": self.rule_review, "justification": self.justification, "signals": self.signals, "component": self.component.to_dict()}


# --- component outputs -----------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class SentimentOutput:
    label: str
    confidence: float
    signals: tuple[tuple[str, str, int], ...]  # (knowledge group, phrase or rule, points)
    component: ComponentInfo


@dataclass(frozen=True)
class IntentOutput:
    label: str
    confidence: float
    alternatives: tuple[tuple[str, float], ...]
    signals: tuple[tuple[str, int], ...]  # (keyword phrase, points) behind the winning intent
    component: ComponentInfo


@dataclass(frozen=True)
class PriorityOutput:
    label: str
    confidence: float
    reasons: tuple[str, ...]
    signals: tuple[tuple[str, int], ...]  # (knowledge group, points)
    component: ComponentInfo


@dataclass(frozen=True)
class Analysis:
    engine_version: str
    knowledge: dict[str, Any]
    components: tuple[ComponentInfo, ...]
    messages: tuple[ProcessedMessage, ...]
    sentiment: SentimentOutput
    intent: IntentOutput
    priority: PriorityOutput
    mentions: tuple[Mention, ...]
    facts: tuple[Fact, ...]
    pending: tuple[PendingItem, ...]
    state: StateResult
    unrecognised_sentences: int
