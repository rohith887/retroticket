"""Feature snapshot: what the engine saw, kept for later review and training. Counts and knowledge ids only, no message text."""
from __future__ import annotations

from collections import Counter
from typing import Any

from app.engine.model import Analysis


def feature_snapshot(analysis: Analysis) -> dict[str, Any]:
    by_party = Counter(m.party for m in analysis.messages)
    claims = [f for f in analysis.facts if f.kind == "claim"]
    return {
        "engineVersion": analysis.engine_version,
        "knowledge": analysis.knowledge["id"] + "@" + analysis.knowledge["version"] + "+" + analysis.knowledge["contentHash"],
        "knowledgeStatus": analysis.knowledge["status"],
        "components": {c.name: c.version for c in analysis.components},
        "messages": {"total": len(analysis.messages), "byParty": dict(sorted(by_party.items())), "sentences": sum(len(m.sentences) for m in analysis.messages), "redactions": sum(m.redactions for m in analysis.messages)},
        "mentions": {kind: sorted({m.id for m in analysis.mentions if m.kind == kind}) for kind in ("entity", "action", "outcome")},
        "facts": {"claims": len(claims), "verified": len(analysis.facts) - len(claims), "requests": sorted({f.request for f in claims if f.request})},
        "pending": dict(sorted(Counter(p.kind for p in analysis.pending).items())),
        "unrecognisedSentences": analysis.unrecognised_sentences,
        "sentiment": {"label": analysis.sentiment.label, "confidence": analysis.sentiment.confidence, "signals": [[g, p, pts] for g, p, pts in analysis.sentiment.signals]},
        "intent": {"label": analysis.intent.label, "confidence": analysis.intent.confidence, "signals": [[k, pts] for k, pts in analysis.intent.signals]},
        "priority": {"label": analysis.priority.label, "confidence": analysis.priority.confidence, "signals": [[g, pts] for g, pts in analysis.priority.signals]},
        "state": {"state": analysis.state.state, "rule": analysis.state.rule_id, "signals": analysis.state.signals},
    }
