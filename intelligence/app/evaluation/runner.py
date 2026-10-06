"""Runs the engine over the golden cases and reports per-dimension counts, separated by curation level."""
from __future__ import annotations

from typing import Any

from app.config import DEFAULT_PACK, KNOWLEDGE_ROOT
from app.engine.model import Analysis
from app.engine.pipeline import Pipeline
from app.evaluation.dataset import Case, load_cases
from app.evaluation.metrics import Exact, SetMatch
from app.knowledge.loader import load_pack

EXACT = ("sentiment", "intent", "priority", "state")
SETS = ("entities", "actions", "outcomes")
FACT_KEYS = ("kind", "entity", "action", "outcome", "count", "polarity", "request", "field")


def _fact_key(f: dict[str, Any]) -> tuple:
    return tuple((k, f[k]) for k in FACT_KEYS if f.get(k) is not None)


def _actual(a: Analysis) -> dict[str, Any]:
    return {
        "sentiment": a.sentiment.label, "intent": a.intent.label, "priority": a.priority.label, "state": a.state.state,
        "entities": {m.id for m in a.mentions if m.kind == "entity"},
        "actions": {m.id for m in a.mentions if m.kind == "action"},
        "outcomes": {m.id for m in a.mentions if m.kind == "outcome"},
        "facts": [f.to_dict() for f in a.facts],
        "parties": {m.id: m.party for m in a.messages},
    }


def _fact_matched(expected: dict[str, Any], facts: list[dict[str, Any]]) -> bool:
    want = _fact_key(expected)
    return any(all(item in _fact_key(f) for item in want) for f in facts)


def evaluate(pipeline: Pipeline, cases: list[Case]) -> dict[str, Any]:
    groups: dict[str, dict[str, Any]] = {}
    mismatches: list[dict[str, Any]] = []
    skipped = [{"id": c.id, "reason": c.unsuitable_reason} for c in cases if not c.suitable]
    for case in (c for c in cases if c.suitable):
        actual = _actual(pipeline.run(case.conversation))
        g = groups.setdefault(case.curation, {"cases": 0, **{k: Exact() for k in EXACT}, **{k: SetMatch() for k in SETS}, "facts": Exact(), "parties": Exact()})
        g["cases"] += 1
        for key, want in case.expected.items():
            if key in EXACT:
                ok = g[key].add(want, actual[key])
                shown = actual[key]
            elif key in SETS:
                ok = g[key].add(set(want), actual[key])
                shown = sorted(actual[key])
            elif key == "facts":
                ok = True
                for exp in want:
                    hit = _fact_matched(exp, actual["facts"])
                    g["facts"].add(True, hit)
                    ok = ok and hit
                shown = "expected fact not found"
            else:  # parties
                ok = True
                for mid, party in want.items():
                    ok = g["parties"].add(party, actual["parties"].get(mid)) and ok
                shown = actual["parties"]
            if not ok:
                mismatches.append({"case": case.id, "dimension": key, "expected": want, "actual": shown})
    reviewed = groups.get("reviewed", {}).get("cases", 0)
    caveat = (
        "No reviewed cases: every case is 'proposed' (written by the engineer, not confirmed by a domain reviewer). These counts show that the rules do what they were written to do on a few examples; they are not accuracy and must not be quoted as such."
        if reviewed == 0
        else f"{reviewed} reviewed cases. The set is still small; treat the counts as a regression signal, not as accuracy."
    )
    return {
        "knowledge": pipeline.pack.fingerprint,
        "knowledgeStatus": pipeline.pack.status,
        "byCuration": {c: {k: (v.to_dict() if hasattr(v, "to_dict") else v) for k, v in g.items()} for c, g in groups.items()},
        "mismatches": mismatches,
        "skippedUnsuitable": skipped,
        "caveat": caveat,
    }


def run(directory=None, cases_path=None) -> dict[str, Any]:
    pack = load_pack(directory or KNOWLEDGE_ROOT / DEFAULT_PACK)
    return evaluate(Pipeline.build(pack), load_cases(cases_path))
