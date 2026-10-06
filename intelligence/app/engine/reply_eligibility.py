"""Reply eligibility: WHEN a draft may be produced at all. Kept apart from the generator on purpose.

This is a business decision, not a wording one: the allowed conversation states come from the reply knowledge
(`allowedStates`, currently only awaiting_support) and can be changed there without touching the generator. The check runs
before any drafting and returns a structured refusal, never a guess.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.engine.model import Analysis
from app.knowledge.reply import ReplyKnowledge


@dataclass(frozen=True)
class Eligibility:
    eligible: bool
    reason: str | None = None  # a reply_model.REASONS value
    detail: str | None = None
    state: str | None = None


class ReplyEligibility:
    def __init__(self, knowledge: ReplyKnowledge):
        self._allowed = tuple(knowledge.file.allowedStates)

    def check(self, analysis: Analysis, has_customer_turn: bool) -> Eligibility:
        state = analysis.state.state
        if not has_customer_turn:
            return Eligibility(False, "no_customer_message", None, state)
        if state not in self._allowed:
            return Eligibility(False, "ambiguous_state", state, state)
        return Eligibility(True, state=state)
