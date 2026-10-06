"""Reply-pattern knowledge (Phase 3C): a separate versioned, validated artifact next to the knowledge pack.

The verification-support pack is not modified by reply drafting: reply wording lives in its own file with its own id, version,
draft/approved status and fingerprint, and names the pack it was written for. Loading follows the same rules as the pack:
strict schema, cross-checks against the pack (entity, action, intent and state ids), deterministic content hash, and an
invalid file keeps the service not ready. The same safety phrases that the validator uses are applied to the patterns at load
time, so an unsafe pattern cannot even be loaded.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.knowledge.loader import KnowledgeError, KnowledgePack
from app.knowledge.schema import Origin, Review, STATE_IDS
from app.utils.errors import ConfigurationError

STEPS = ("opening", "claims", "request_ack", "verified_status", "ask_which_document", "ask_missing_entity", "closing")
SLOTS = {"entity", "action", "outcome", "count", "value"}
_SLOT = re.compile(r"\{(\w+)\}")
_ID = r"^[a-z][a-z0-9_.]{1,63}$"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Limits(_Strict):
    maxSentences: int = Field(ge=2, le=20)
    maxChars: int = Field(ge=100, le=2000)
    maxClaims: int = Field(ge=1, le=10)


class IntentPlan(_Strict):
    requiresEntity: bool
    steps: list[Literal["opening", "claims", "request_ack", "verified_status", "ask_which_document", "ask_missing_entity", "closing"]] = Field(min_length=1)


class Pattern(_Strict):
    id: str = Field(pattern=_ID)
    step: Literal["opening", "claims", "request_ack", "verified_status", "ask_which_document", "ask_missing_entity", "closing"]
    template: str = Field(min_length=5, max_length=240)
    when: dict[str, Any] = Field(default_factory=dict)
    entities: list[str] = Field(default_factory=list)
    origin: Origin
    review: Review
    note: str = Field(default="", max_length=400)


class Validation(_Strict):
    forbiddenPhrases: list[str] = Field(min_length=1)


class ReplyFile(_Strict):
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{1,63}$")
    name: str = Field(max_length=120)
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    schemaVersion: Literal[1]
    status: Literal["draft", "approved"]
    language: Literal["en"]
    packId: str
    description: str = Field(max_length=800)
    reviewNotes: list[str] = Field(default_factory=list)
    limits: Limits
    ignoreActions: list[str] = Field(default_factory=list)
    allowedStates: list[str] = Field(min_length=1)
    unknownIntents: list[str] = Field(default_factory=list)
    intents: dict[str, IntentPlan]
    patterns: list[Pattern] = Field(min_length=1)
    validation: Validation


@dataclass(frozen=True)
class ReplyKnowledge:
    file: ReplyFile
    content_hash: str
    forbidden: re.Pattern[str]

    @property
    def fingerprint(self) -> str:
        return f"{self.file.id}@{self.file.version}+{self.content_hash[:12]}"

    @property
    def status(self) -> str:
        return self.file.status

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.file.id,
            "version": self.file.version,
            "status": self.file.status,
            "contentHash": self.content_hash[:12],
            "patterns": len(self.file.patterns),
            "needsReview": sum(1 for p in self.file.patterns if p.review == "needs_review"),
        }

    def patterns_for(self, step: str) -> list[Pattern]:
        return [p for p in self.file.patterns if p.step == step]


def forbidden_regex(phrases: list[str]) -> re.Pattern[str]:
    """Prefix match on word starts, case-insensitive: 'escalat' catches escalate and escalation."""
    return re.compile("|".join(r"(?<![a-z])" + re.escape(p.lower()) for p in phrases), re.IGNORECASE)


def load_reply_knowledge(path: Path, pack: KnowledgePack, *, check_intents: bool = True) -> ReplyKnowledge:
    """check_intents=False when INTENTS_FILE replaces the pack intents (development override): labels may differ then."""
    path = Path(path)
    problems: list[str] = []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise KnowledgeError([f"{path.name}: file not found"]) from None
    except (OSError, ValueError) as exc:
        raise KnowledgeError([f"{path.name}: cannot be read as JSON ({type(exc).__name__})"]) from None
    try:
        file = ReplyFile.model_validate(raw)
    except ValidationError as exc:
        raise KnowledgeError([f"{path.name}: {'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:6]]) from None

    if file.packId != pack.manifest.id:
        problems.append(f"replies: written for pack '{file.packId}' but pack '{pack.manifest.id}' is loaded")
    ids = [p.id for p in file.patterns]
    problems += [f"replies: duplicate pattern id '{i}'" for i in sorted({i for i in ids if ids.count(i) > 1})]

    entity_ids = {e.id for e in pack.entities.entities}
    action_ids = {a.id for a in pack.actions.actions}
    intent_labels = {d.label for d in pack.intents.definitions}
    for a in file.ignoreActions:
        if a not in action_ids:
            problems.append(f"replies: ignoreActions names unknown action '{a}'")
    for s in file.allowedStates:
        if s not in STATE_IDS:
            problems.append(f"replies: allowedStates names unknown state '{s}'")
    for label in (list(file.intents) + file.unknownIntents) if check_intents else ():
        if label not in intent_labels:
            problems.append(f"replies: unknown intent '{label}'")
    for label in file.unknownIntents:
        if label in file.intents:
            problems.append(f"replies: intent '{label}' cannot be both supported and unknown")

    forbidden = forbidden_regex(file.validation.forbiddenPhrases)
    steps_present = {p.step for p in file.patterns}
    for label, plan in file.intents.items():
        for step in plan.steps:
            if step not in steps_present:
                problems.append(f"replies: intent '{label}' uses step '{step}' that has no pattern")
        if plan.steps[0] != "opening" or plan.steps[-1] != "closing":
            problems.append(f"replies: intent '{label}' must start with opening and end with closing")
    for p in file.patterns:
        for slot in _SLOT.findall(p.template):
            if slot not in SLOTS:
                problems.append(f"replies: pattern '{p.id}' uses unknown slot '{slot}'")
        text = _SLOT.sub("x", p.template)
        if forbidden.search(text):
            problems.append(f"replies: pattern '{p.id}' contains a forbidden phrase")
        if re.search(r"\d|https?:|www\.|@", text):
            problems.append(f"replies: pattern '{p.id}' contains a digit, link or address")
        for e in p.entities:
            if e not in entity_ids:
                problems.append(f"replies: pattern '{p.id}' names unknown entity '{e}'")
        if p.step == "claims" and not {"hasAction", "hasOutcome", "polarity"} <= set(p.when):
            problems.append(f"replies: claim pattern '{p.id}' needs hasAction, hasOutcome and polarity")
        if p.step == "verified_status" and "{value}" not in p.template:
            problems.append(f"replies: pattern '{p.id}' must use {{value}}")
    if file.status == "approved" and any(p.review != "approved" for p in file.patterns):
        problems.append("replies: marked approved but some patterns are not approved")
    if problems:
        raise KnowledgeError(problems)

    canonical = json.dumps(raw, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return ReplyKnowledge(file, hashlib.sha256(canonical.encode()).hexdigest(), forbidden)


__all__ = ["ReplyKnowledge", "load_reply_knowledge", "forbidden_regex", "ConfigurationError"]
