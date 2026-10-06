"""Deterministic loading and validation of a knowledge pack.

Loading reads plain JSON files from a pack directory, validates every file against its schema, then runs cross-file checks
(unique ids, references, required groups, rule conditions). All problems are collected and reported together. The result is
an immutable `KnowledgePack` with a stable fingerprint (id, version and a hash of the canonical content), so every engine
output can say exactly which knowledge produced it.

An invalid pack raises `KnowledgeError`; the service then refuses to become ready.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.intelligence.intent import IntentCatalog
from app.knowledge import schema as S
from app.utils.errors import ConfigurationError


class KnowledgeError(ConfigurationError):
    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems[:5]) + (f" (+{len(problems) - 5} more)" if len(problems) > 5 else ""))
        self.problems = problems


class IndicatorSet:
    """Phrase groups, patterns and weights from indicators.json."""

    def __init__(self, file: S.IndicatorsFile):
        self._groups = {g.id: tuple(g.phrases) for g in file.groups}
        self._patterns = {p.id: re.compile(p.regex) for p in file.patterns}
        self._weights = dict(file.weights)

    def phrases(self, group_id: str) -> tuple[str, ...]:
        return self._groups[group_id]

    def optional(self, group_id: str) -> tuple[str, ...]:
        """A group that a pack may leave out (for example the *_extra groups): empty when absent."""
        return self._groups.get(group_id, ())

    def pattern(self, pattern_id: str) -> re.Pattern[str]:
        return self._patterns[pattern_id]

    def weight(self, name: str) -> int:
        return self._weights[name]


@dataclass(frozen=True)
class KnowledgePack:
    manifest: S.PackManifest
    intents: IntentCatalog
    indicators: IndicatorSet
    entities: S.EntitiesFile
    actions: S.ActionsFile
    outcomes: S.OutcomesFile
    states: S.StatesFile
    realisation: S.RealisationFile
    content_hash: str
    needs_review: int
    entry_count: int

    @property
    def fingerprint(self) -> str:
        return f"{self.manifest.id}@{self.manifest.version}+{self.content_hash[:12]}"

    @property
    def status(self) -> str:
        return self.manifest.status

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.manifest.id,
            "version": self.manifest.version,
            "status": self.manifest.status,
            "contentHash": self.content_hash[:12],
            "entries": self.entry_count,
            "needsReview": self.needs_review,
        }


def _read(path: Path, problems: list[str]) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        problems.append(f"{path.name}: file not found")
    except (OSError, ValueError) as exc:
        problems.append(f"{path.name}: cannot be read as JSON ({type(exc).__name__})")
    return None


def _validate(model, data: Any, name: str, problems: list[str]):
    if data is None:
        return None
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        for err in exc.errors()[:6]:
            where = ".".join(str(p) for p in err["loc"])
            problems.append(f"{name}: {where}: {err['msg']}")
    return None


def _duplicates(ids: list[str]) -> list[str]:
    seen, dup = set(), []
    for i in ids:
        if i in seen and i not in dup:
            dup.append(i)
        seen.add(i)
    return dup


def _canonical(data: Any) -> str:
    return json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def load_pack(directory: Path, *, require_approved: bool = False, intents_file: Path | None = None) -> KnowledgePack:
    """`intents_file` replaces the pack's own intents (development override, see INTENTS_FILE)."""
    directory = Path(directory)
    problems: list[str] = []
    manifest_raw = _read(directory / "pack.json", problems)
    manifest = _validate(S.PackManifest, manifest_raw, "pack.json", problems)
    if manifest is None:
        raise KnowledgeError(problems or ["pack.json is invalid"])

    raw: dict[str, Any] = {}
    files = manifest.files.model_dump()
    for key, filename in files.items():
        raw[key] = _read(directory / filename, problems)

    indicators = _validate(S.IndicatorsFile, raw["indicators"], files["indicators"], problems)
    entities = _validate(S.EntitiesFile, raw["entities"], files["entities"], problems)
    actions = _validate(S.ActionsFile, raw["actions"], files["actions"], problems)
    outcomes = _validate(S.OutcomesFile, raw["outcomes"], files["outcomes"], problems)
    states = _validate(S.StatesFile, raw["states"], files["states"], problems)
    realisation = _validate(S.RealisationFile, raw["realisation"], files["realisation"], problems)

    intents = None
    try:
        intents = IntentCatalog.load(intents_file or (directory / files["intents"]))
    except ConfigurationError as exc:
        problems.append(f"{files['intents']}: {exc}")

    if not problems:
        _cross_check(manifest, indicators, entities, actions, outcomes, states, realisation, intents, problems, check_requests=intents_file is None)

    # Review bookkeeping: every entry that carries a review value.
    reviews: list[str] = []
    if not problems:
        for group in (indicators.groups, indicators.patterns, entities.entities, actions.actions, outcomes.outcomes, states.resolvedTicketStatuses, states.rules, realisation.requestPhrases):
            reviews += [e.review for e in group]
        reviews += [t.review for t in realisation.factTemplates + realisation.verifiedTemplates + realisation.statePhrases]
        reviews += [d.review or "needs_review" for d in intents.definitions]
        if manifest.status == "approved":
            not_approved = sum(1 for r in reviews if r != "approved")
            if not_approved:
                problems.append(f"pack is marked approved but {not_approved} entries are not approved")
        if require_approved and manifest.status != "approved":
            problems.append("a draft pack cannot be used while KNOWLEDGE_REQUIRE_APPROVED is set")
    if problems:
        raise KnowledgeError(problems)

    digest = hashlib.sha256()
    for name in sorted(files):
        source = intents_file if (name == "intents" and intents_file) else directory / files[name]
        digest.update(name.encode())
        digest.update(_canonical(json.loads(Path(source).read_text(encoding="utf-8"))).encode())
    digest.update(_canonical(manifest_raw).encode())

    return KnowledgePack(
        manifest=manifest,
        intents=intents,
        indicators=IndicatorSet(indicators),
        entities=entities,
        actions=actions,
        outcomes=outcomes,
        states=states,
        realisation=realisation,
        content_hash=digest.hexdigest(),
        needs_review=sum(1 for r in reviews if r == "needs_review"),
        entry_count=len(reviews),
    )


def _cross_check(manifest, indicators, entities, actions, outcomes, states, realisation, intents, problems: list[str], check_requests: bool = True) -> None:
    for name, ids in (
        ("indicators groups", [g.id for g in indicators.groups]),
        ("indicators patterns", [p.id for p in indicators.patterns]),
        ("entities", [e.id for e in entities.entities]),
        ("entity types", [t.id for t in entities.entityTypes]),
        ("actions", [a.id for a in actions.actions]),
        ("outcomes", [o.id for o in outcomes.outcomes]),
        ("state rules", [r.id for r in states.rules]),
    ):
        for dup in _duplicates(ids):
            problems.append(f"{name}: duplicate id '{dup}'")

    for group in S.REQUIRED_GROUPS:
        if group not in {g.id for g in indicators.groups}:
            problems.append(f"indicators: required group '{group}' is missing")
    for pattern in S.REQUIRED_PATTERNS:
        if pattern not in {p.id for p in indicators.patterns}:
            problems.append(f"indicators: required pattern '{pattern}' is missing")
    for weight in S.REQUIRED_WEIGHTS:
        if weight not in indicators.weights:
            problems.append(f"indicators: required weight '{weight}' is missing")

    types = {t.id for t in entities.entityTypes}
    for entity in entities.entities:
        if entity.type not in types:
            problems.append(f"entities: '{entity.id}' has unknown type '{entity.type}'")

    state_ids = {s.id for s in states.states}
    if state_ids != set(S.STATE_IDS):
        problems.append(f"states: the state list must be exactly {', '.join(S.STATE_IDS)}")
    for rule in states.rules:
        if rule.then not in state_ids:
            problems.append(f"states: rule {rule.id} leads to unknown state '{rule.then}'")
        for key, value in rule.when.items():
            expected = S.RULE_CONDITIONS.get(key)
            if expected is None:
                problems.append(f"states: rule {rule.id} uses unknown condition '{key}'")
            elif not isinstance(value, expected) or (expected is int and isinstance(value, bool)):
                problems.append(f"states: rule {rule.id} condition '{key}' has the wrong type")
            elif key == "lastMessageHas" and value not in S.MESSAGE_SIGNALS:
                problems.append(f"states: rule {rule.id} uses unknown message signal '{value}'")
            elif key == "lastPublicParty" and value not in ("customer", "agent"):
                problems.append(f"states: rule {rule.id} uses unknown party '{value}'")
    for phrase in realisation.statePhrases:
        if phrase.state not in state_ids:
            problems.append(f"realisation: state phrase for unknown state '{phrase.state}'")

    labels = {d.label for d in intents.definitions}
    for request in realisation.requestPhrases if check_requests else ():  # a development intents override may use other labels
        if request.intent not in labels:
            problems.append(f"realisation: request phrase for unknown intent '{request.intent}'")
