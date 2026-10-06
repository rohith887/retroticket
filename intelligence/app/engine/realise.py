"""Deterministic realiser foundation (used by Phase 3B summaries; no summary is produced in 3A).

Every sentence is a template from the knowledge pack (realisation.json) filled with knowledge labels and extracted slots.
It can only say what the facts contain. A customer's statement is always phrased as a claim ("The customer says ...");
only verified facts are stated plainly. Returns None when no template applies: never improvises.
"""
from __future__ import annotations

from app.engine.model import Fact
from app.knowledge.loader import KnowledgePack


class Realiser:
    def __init__(self, pack: KnowledgePack):
        r = pack.realisation
        self._templates = r.factTemplates
        self._verified = {t.field: t for t in r.verifiedTemplates}
        self._states = {p.state: p.phrase for p in r.statePhrases}
        self._requests = {p.intent: p.phrase for p in r.requestPhrases}
        self._counts = r.countWords
        self._entities = {e.id: e.label for e in pack.entities.entities}
        self._actions = {a.id: a.label for a in pack.actions.actions}
        self._outcomes = {o.id: o.label for o in pack.outcomes.outcomes}

    @staticmethod
    def _matches(when: dict, fact: Fact) -> bool:
        checks = {
            "party": fact.party, "kind": fact.kind, "polarity": fact.polarity,
            "hasAction": fact.action is not None, "hasOutcome": fact.outcome is not None,
        }
        return all(checks.get(key) == value for key, value in when.items())

    def slots(self, fact: Fact) -> dict[str, str]:
        """Knowledge labels and the count phrase for a fact (shared with the reply generator, so wording data lives in one place)."""
        count = self._counts.get(str(fact.count)) if fact.count is not None else None
        return {
            "entity": self._entities.get(fact.entity or "", ""),
            "action": self._actions.get(fact.action or "", ""),
            "outcome": self._outcomes.get(fact.outcome or "", ""),
            "count": f" {count}" if count else "",
        }

    def fact(self, fact: Fact) -> str | None:
        if fact.kind != "claim" or fact.entity is None:
            return None
        for template in self._templates:
            if self._matches(template.when, fact):
                count = f" {self._counts[str(fact.count)]}" if fact.count is not None and str(fact.count) in self._counts else ""
                return template.template.format(
                    entity=self._entities[fact.entity], action=self._actions.get(fact.action, ""), outcome=self._outcomes.get(fact.outcome, ""), count=count,
                ).replace("  ", " ")
        return None

    def request(self, fact: Fact) -> str | None:
        phrase = self._requests.get(fact.request or "")
        return f"The customer {phrase}." if phrase else None

    def verified(self, fact: Fact) -> str | None:
        if fact.kind != "verified" or fact.field not in self._verified or not isinstance(fact.value, str):
            return None
        return self._verified[fact.field].template.format(value=fact.value)

    def state(self, state: str) -> str:
        return self._states.get(state) or self._states["unknown"]
