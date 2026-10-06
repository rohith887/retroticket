"""Deterministic conversation summary (Phase 3B): facts and state in, template sentences out.

Nothing here writes free text. Every line is produced by the Realiser from a fact or from the state, and points back to the
facts and message sentences it came from. Customer statements stay claims ("The customer says ..."); only the ticket
status and priority Node supplied are stated plainly. Lines that rest on knowledge still marked `needs_review` say so, and
the summary carries warnings instead of hiding that. The knowledge pack is consumed as it is: this module adds no vocabulary.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.engine.model import Analysis, ComponentInfo, Fact
from app.engine.realise import Realiser
from app.knowledge.loader import KnowledgePack

SUMMARY_VERSION = "1.0"
COMPONENT = ComponentInfo("rules-summary", SUMMARY_VERSION)
MAX_CLAIM_LINES = 8
MAX_REQUEST_LINES = 3


@dataclass(frozen=True)
class SummaryLine:
    section: str  # request | claim | verified | state
    text: str
    fact_ids: tuple[str, ...]
    sources: tuple[tuple[str, int | None], ...]  # (message id, sentence index)
    review: str  # established | needs_review

    def to_dict(self) -> dict[str, Any]:
        return {
            "section": self.section,
            "text": self.text,
            "factIds": list(self.fact_ids),
            "sources": [{"messageId": m, "sentenceIndex": s} for m, s in self.sources],
            "review": self.review,
        }


def _reviews(pack: KnowledgePack) -> dict[tuple[str, str], str]:
    out: dict[tuple[str, str], str] = {}
    for e in pack.entities.entities:
        out[("entity", e.id)] = e.review
    for a in pack.actions.actions:
        out[("action", a.id)] = a.review
    for o in pack.outcomes.outcomes:
        out[("outcome", o.id)] = o.review
    return out


def build_summary(analysis: Analysis, pack: KnowledgePack) -> dict[str, Any]:
    realiser = Realiser(pack)
    reviews = _reviews(pack)
    unresolved_vocabulary: set[str] = set()

    def review_of(fact: Fact) -> str:
        level = "established"
        for kind, value in (("entity", fact.entity), ("action", fact.action), ("outcome", fact.outcome)):
            if value and reviews.get((kind, value)) == "needs_review":
                unresolved_vocabulary.add(value)
                level = "needs_review"
        return level

    lines: list[SummaryLine] = []

    # 1. What the customer is asking for (from request facts), one line per distinct intent
    seen: set[str] = set()
    for fact in analysis.facts:
        if fact.request and fact.request not in seen and len(seen) < MAX_REQUEST_LINES:
            text = realiser.request(fact)
            if text:
                seen.add(fact.request)
                lines.append(SummaryLine("request", text, (fact.id,), ((fact.provenance.message_id or "", fact.provenance.sentence_index),), "established"))

    # 2. What the customer claims, in message order, without duplicates
    said: set[str] = set()
    skipped = 0
    for fact in analysis.facts:
        if fact.kind != "claim" or fact.request or not fact.entity or not (fact.action or fact.outcome):
            continue
        text = realiser.fact(fact)
        if text is None or text in said:
            continue
        if len([x for x in lines if x.section == "claim"]) >= MAX_CLAIM_LINES:
            skipped += 1
            continue
        said.add(text)
        lines.append(SummaryLine("claim", text, (fact.id,), ((fact.provenance.message_id or "", fact.provenance.sentence_index),), review_of(fact)))

    # 3. What the system records (verified)
    for fact in analysis.facts:
        if fact.kind == "verified" and fact.field in ("status", "priority"):
            text = realiser.verified(fact)
            if text:
                lines.append(SummaryLine("verified", text, (fact.id,), (), "established"))

    # 4. Where the conversation stands
    state = analysis.state
    lines.append(SummaryLine("state", realiser.state(state.state), (), (), state.rule_review if state.rule_review == "needs_review" else "established"))

    warnings: list[str] = []
    if pack.status == "draft":
        warnings.append("Based on a draft knowledge pack that has not been approved.")
    if unresolved_vocabulary:
        warnings.append("Some wording rests on vocabulary still under review: " + ", ".join(sorted(unresolved_vocabulary)) + ".")
    if state.rule_review == "needs_review":
        warnings.append(f"The conversation state comes from rule {state.rule_id}, which is still under review.")
    if analysis.unrecognised_sentences:
        warnings.append(f"{analysis.unrecognised_sentences} customer sentence(s) could not be interpreted and are not summarised.")
    if skipped:
        warnings.append(f"{skipped} further customer statement(s) are not listed.")

    return {
        "text": " ".join(line.text for line in lines),
        "lines": [line.to_dict() for line in lines],
        "pending": [p.to_dict() for p in analysis.pending],
        "warnings": warnings,
        "realiser": COMPONENT.to_dict(),
        "knowledge": pack.fingerprint,
    }
