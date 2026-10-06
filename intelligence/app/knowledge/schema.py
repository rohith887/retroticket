"""Schema of a knowledge pack: every file, every entry, and the review status that separates draft from approved.

Each entry says where its vocabulary came from (`origin`) and how far it has been reviewed (`review`):

  origin   code | data | lexicon | inferred | user_example
  review   approved      confirmed by the business
           established   found in existing code, templates, stored data or lexicons, but not yet approved
           needs_review  inferred or taken from an example: must be confirmed or removed

A pack may only be marked `approved` when every entry is `approved`. Unknown fields are rejected everywhere.
"""
from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Origin = Literal["code", "data", "lexicon", "inferred", "user_example"]
Review = Literal["approved", "established", "needs_review"]
_ID = r"^[a-z][a-z0-9_.]{1,63}$"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Reviewed(_Strict):
    origin: Origin
    review: Review
    note: str = Field(default="", max_length=400)


class PackFiles(_Strict):
    intents: str
    indicators: str
    entities: str
    actions: str
    outcomes: str
    states: str
    realisation: str


class PackManifest(_Strict):
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{1,63}$")
    name: str = Field(max_length=120)
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    schemaVersion: Literal[1]
    status: Literal["draft", "approved"]
    language: Literal["en"]
    description: str = Field(max_length=800)
    files: PackFiles
    reviewNotes: list[str] = Field(default_factory=list)


# --- indicators ------------------------------------------------------------------------------------------------------
class PhraseGroup(Reviewed):
    id: str = Field(pattern=_ID)
    phrases: list[str] = Field(min_length=1)

    @field_validator("phrases")
    @classmethod
    def _clean(cls, values: list[str]) -> list[str]:
        cleaned = [v.strip().lower() for v in values]
        if any(not v for v in cleaned):
            raise ValueError("phrases must not be blank")
        return cleaned


class PatternDef(Reviewed):
    id: str = Field(pattern=_ID)
    regex: str

    @field_validator("regex")
    @classmethod
    def _compiles(cls, value: str) -> str:
        try:
            re.compile(value)
        except re.error as exc:
            raise ValueError(f"invalid regular expression: {exc}") from exc
        return value


class IndicatorsFile(_Strict):
    comment: str | None = Field(default=None, alias="_comment")
    weights: dict[str, int]
    groups: list[PhraseGroup]
    patterns: list[PatternDef] = Field(default_factory=list)


REQUIRED_GROUPS = (
    "sentiment.positive_strong", "sentiment.positive_weak", "sentiment.negative_strong", "sentiment.negative_weak", "sentiment.frustration",
    "priority.urgent", "priority.legal", "priority.deadline", "priority.blocking", "priority.repeat", "priority.issue",
    "message.automated", "message.information_request", "message.acknowledgement", "message.closing", "message.open_request",
    "message.resolution_claim", "message.problem",
)
REQUIRED_PATTERNS = ("frustration.times", "frustration.nth_time")
REQUIRED_WEIGHTS = ("frustration_phrase",)


# --- entities / actions / outcomes ---------------------------------------------------------------------------------------
class EntityType(_Strict):
    id: str = Field(pattern=_ID)
    label: str


class SynonymEntry(Reviewed):
    id: str = Field(pattern=_ID)
    label: str = Field(min_length=1, max_length=80)
    synonyms: list[str] = Field(min_length=1)

    @field_validator("synonyms")
    @classmethod
    def _clean(cls, values: list[str]) -> list[str]:
        cleaned = [v.strip().lower() for v in values]
        if any(not v for v in cleaned):
            raise ValueError("synonyms must not be blank")
        return cleaned


class EntityDef(SynonymEntry):
    type: str


class EntitiesFile(_Strict):
    entityTypes: list[EntityType]
    entities: list[EntityDef]


class ActionsFile(_Strict):
    actions: list[SynonymEntry]


class OutcomeDef(SynonymEntry):
    polarity: Literal["negative", "positive", "pending", "neutral"]


class OutcomesFile(_Strict):
    outcomes: list[OutcomeDef]


# --- states ----------------------------------------------------------------------------------------------------------
STATE_IDS = ("resolved", "awaiting_support", "awaiting_customer", "unresolved", "unknown")
RULE_CONDITIONS = {"verifiedResolved": bool, "publicMessages": int, "lastPublicParty": str, "lastMessageHas": str, "unresolvedProblemClaims": bool}
MESSAGE_SIGNALS = ("open_request", "closing_only", "information_request")


class StateDef(_Strict):
    id: str
    description: str


class ResolvedStatus(Reviewed):
    value: str


class StateRule(Reviewed):
    id: str = Field(pattern=r"^R\d+$")
    when: dict[str, Any]
    then: str
    justification: str = Field(min_length=10, max_length=400)


class StatesFile(_Strict):
    comment: str | None = Field(default=None, alias="_comment")
    states: list[StateDef]
    resolvedTicketStatuses: list[ResolvedStatus]
    rules: list[StateRule]


# --- realisation -----------------------------------------------------------------------------------------------------
class RequestPhrase(Reviewed):
    intent: str
    phrase: str


class FactTemplate(_Strict):
    id: str
    when: dict[str, Any]
    template: str
    review: Review


class VerifiedTemplate(_Strict):
    id: str
    field: Literal["status", "priority"]
    template: str
    review: Review


class StatePhrase(_Strict):
    state: str
    phrase: str
    review: Review


class RealisationFile(_Strict):
    comment: str | None = Field(default=None, alias="_comment")
    requestPhrases: list[RequestPhrase]
    countWords: dict[str, str]
    factTemplates: list[FactTemplate]
    verifiedTemplates: list[VerifiedTemplate]
    statePhrases: list[StatePhrase]
