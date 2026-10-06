"""Data model of a reply draft. Every sentence carries the source that explains why it exists."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.engine.model import ComponentInfo

REASONS = ("no_customer_message", "ambiguous_state", "unknown_intent", "unsupported_request", "missing_entity", "no_safe_pattern")


@dataclass(frozen=True)
class ReplyContext:
    """Conversation sequence numbers supplied by Node. If the conversation moved on, the draft is stale and is refused."""

    based_on_seq: int | None = None
    current_seq: int | None = None


@dataclass(frozen=True)
class Source:
    type: str  # claim | verified_fact | pattern
    pattern_id: str
    fact_ids: tuple[str, ...] = ()
    message_id: str | None = None
    sentence_index: int | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"type": self.type, "patternId": self.pattern_id, "factIds": list(self.fact_ids)}
        if self.message_id is not None:
            out["messageId"] = self.message_id
            out["sentenceIndex"] = self.sentence_index
        return out


@dataclass(frozen=True)
class ReplySentence:
    text: str
    source: Source

    def to_dict(self) -> dict[str, Any]:
        return {"text": self.text, "source": self.source.to_dict()}


@dataclass(frozen=True)
class ReplyDraft:
    status: str  # ready | insufficient_context | validation_failed
    generator: ComponentInfo
    knowledge: str  # reply knowledge fingerprint
    reason: str | None = None
    detail: str | None = None
    intent: str | None = None
    state: str | None = None
    sentences: tuple[ReplySentence, ...] = ()
    warnings: tuple[str, ...] = ()
    failures: tuple[dict[str, Any], ...] = field(default_factory=tuple)

    @property
    def body(self) -> str:
        return " ".join(s.text for s in self.sentences) if self.status == "ready" else ""

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "status": self.status,
            "body": self.body,
            "sentences": [s.to_dict() for s in self.sentences] if self.status == "ready" else [],
            "intent": self.intent,
            "state": self.state,
            "warnings": list(self.warnings),
            "generator": self.generator.to_dict(),
            "knowledge": self.knowledge,
        }
        if self.reason:
            out["reason"] = self.reason
        if self.detail:
            out["detail"] = self.detail
        if self.failures:
            out["failures"] = list(self.failures)
        return out
