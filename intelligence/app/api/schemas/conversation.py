"""Request/response models for POST /api/v1/analyze-conversation. Unknown fields are rejected."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.api.schemas.analysis import Meta


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TicketIn(_Strict):
    """Structured ticket state supplied by Node. This is the only source of VERIFIED facts."""

    status: str = Field(min_length=1, max_length=40)
    priority: str | None = Field(default=None, max_length=20)
    isResolved: bool = False


class MessageIn(_Strict):
    id: str = Field(min_length=1, max_length=64)
    role: Literal["customer", "agent", "internal_note", "system"]
    at: str | None = Field(default=None, max_length=40)
    text: str

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text must not be empty")
        return value


class EventIn(_Strict):
    id: str = Field(min_length=1, max_length=64)
    type: str = Field(min_length=1, max_length=40)
    at: str | None = Field(default=None, max_length=40)
    data: dict[str, Any] = Field(default_factory=dict)


class ConversationRequest(_Strict):
    ticketId: str | None = Field(default=None, max_length=64)
    locale: Literal["en"] = "en"
    ticket: TicketIn
    messages: list[MessageIn] = Field(min_length=1, max_length=60)
    events: list[EventIn] = Field(default_factory=list, max_length=50)


class ConversationResponse(_Strict):
    engineVersion: str
    knowledge: dict[str, Any]
    components: list[dict[str, str]]
    sentiment: dict[str, Any]
    intent: dict[str, Any]
    priority: dict[str, Any]
    entities: list[dict[str, Any]]
    facts: list[dict[str, Any]]
    pending: list[dict[str, Any]]
    unrecognisedSentences: int
    state: dict[str, Any]
    summary: dict[str, Any]
    featureSnapshot: dict[str, Any]
    meta: Meta


class SequenceIn(_Strict):
    """Conversation sequence numbers from Node. current > basedOn means the conversation moved on while generating."""

    basedOn: int = Field(ge=0)
    current: int = Field(ge=0)


class ReplyRequest(ConversationRequest):
    sequence: SequenceIn | None = None


class ReplyResponse(_Strict):
    engineVersion: str
    knowledge: dict[str, Any]
    replyKnowledge: dict[str, Any]
    components: list[dict[str, str]]
    replyDraft: dict[str, Any]
    state: dict[str, Any]
    featureSnapshot: dict[str, Any]
    meta: Meta
