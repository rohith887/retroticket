"""Pydantic request/response models: the Node <-> Python contract (v1). Unknown fields are rejected."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SentimentLabel = Literal["positive", "neutral", "negative", "frustrated"]
PriorityLabel = Literal["low", "medium", "high", "critical"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MessageRequest(_Strict):
    """A single customer message. The ids are opaque references echoed nowhere and used only for log correlation."""

    ticketId: str | None = Field(default=None, max_length=64)
    conversationId: str | None = Field(default=None, max_length=64)
    messageId: str | None = Field(default=None, max_length=64)
    text: str

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text must not be empty")
        return value


class SentimentOut(_Strict):
    label: SentimentLabel
    confidence: float = Field(ge=0, le=1)


class IntentAlternative(_Strict):
    label: str
    confidence: float = Field(ge=0, le=1)


class IntentOut(_Strict):
    label: str
    confidence: float = Field(ge=0, le=1)
    alternatives: list[IntentAlternative] = Field(default_factory=list)


class PriorityOut(_Strict):
    label: PriorityLabel
    confidence: float = Field(ge=0, le=1)
    reasons: list[str] = Field(default_factory=list)


class Meta(_Strict):
    provider: str
    model: str
    version: str
    latencyMs: float
    requestId: str
    # Which engine, knowledge pack and components produced the result (stored by Node for later review).
    engineVersion: str | None = None
    knowledge: str | None = None
    componentVersions: dict[str, str] | None = None


class SentimentResponse(_Strict):
    sentiment: SentimentOut
    meta: Meta


class IntentResponse(_Strict):
    intent: IntentOut
    meta: Meta


class PriorityResponse(_Strict):
    priority: PriorityOut
    meta: Meta


class AnalyzeMessageResponse(_Strict):
    sentiment: SentimentOut
    intent: IntentOut
    priority: PriorityOut
    meta: Meta


class IntentDefinitionOut(_Strict):
    label: str
    description: str


class IntentsResponse(_Strict):
    intents: list[IntentDefinitionOut]
    meta: Meta
