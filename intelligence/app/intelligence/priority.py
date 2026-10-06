"""Rule-based priority suggestion (engine component "rules-priority"). It only recommends; the caller decides.

Labels: low | medium | high | critical. Phrase groups come from the knowledge pack (indicators.json).

Points (each category counts once, so repeating a word does not inflate the score):
  urgent language (urgent, asap, outage, system down, ...)   3 per distinct term, max 6
  legal threat (lawyer, court, legal action, ...)             3
  repeated failure (already submitted, nobody, "3 times")     2 for the first match, +1 for each further one, max 3
  blocked (cannot access, unable to, locked out, security)    2
  deadline (deadline, by tomorrow, expires)                   2
  reports an error or issue (error, bug, problem, login)      1
  customer appears frustrated (from the sentiment rules)      1

  critical  >= 8        high  >= 4        medium  >= 2        low  otherwise

Confidence is match strength, not a probability:
  no signals at all                     0.40  (the default "low", stated as such in the reasons)
  otherwise  min(0.90, 0.50 + 0.04 * points + 0.04 * (distinct categories - 1))
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.intelligence import sentiment
from app.intelligence.text import clean, find
from app.knowledge.loader import IndicatorSet


@dataclass(frozen=True)
class PrioritySignal:
    reason: str
    points: int
    group: str = ""  # which knowledge group produced it


def _distinct_hits(lower: str, phrases: tuple[str, ...]) -> int:
    return sum(1 for phrase in phrases if find(lower, phrase))


def signals(text: str, indicators: IndicatorSet, sentiment_label: str | None = None) -> list[PrioritySignal]:
    lower = clean(text).lower()
    found: list[PrioritySignal] = []

    urgent = _distinct_hits(lower, indicators.phrases("priority.urgent"))
    if urgent:
        found.append(PrioritySignal("Urgent language used", min(6, 3 * urgent), "priority.urgent"))
    if _distinct_hits(lower, indicators.phrases("priority.legal")):
        found.append(PrioritySignal("Legal action or escalation is mentioned", 3, "priority.legal"))

    repeat_patterns = [indicators.pattern("frustration.times"), indicators.pattern("frustration.nth_time")]
    repeat = _distinct_hits(lower, indicators.phrases("priority.repeat")) + sum(1 for p in repeat_patterns if p.search(lower))
    if repeat:
        found.append(PrioritySignal("Repeated failed attempts or no response so far", min(3, 2 + (repeat - 1)), "priority.repeat"))

    if _distinct_hits(lower, indicators.phrases("priority.blocking")):
        found.append(PrioritySignal("Customer is blocked from proceeding", 2, "priority.blocking"))
    if _distinct_hits(lower, indicators.phrases("priority.deadline")):
        found.append(PrioritySignal("A deadline is mentioned", 2, "priority.deadline"))
    if _distinct_hits(lower, indicators.phrases("priority.issue")):
        found.append(PrioritySignal("Customer reports an error or unresolved issue", 1, "priority.issue"))

    if sentiment_label is None:
        sentiment_label, _ = sentiment.analyze(text, indicators)
    if sentiment_label == "frustrated":
        found.append(PrioritySignal("Customer appears frustrated", 1, "sentiment"))
    return sorted(found, key=lambda s: -s.points)


def suggest_with_signals(text: str, indicators: IndicatorSet, sentiment_label: str | None = None) -> tuple[str, float, list[str], list[PrioritySignal]]:
    found = signals(text, indicators, sentiment_label)
    points = sum(s.points for s in found)
    if points == 0:
        return "low", 0.40, ["No urgency or issue signals detected"], []
    label = "critical" if points >= 8 else "high" if points >= 4 else "medium" if points >= 2 else "low"
    confidence = min(0.90, 0.50 + 0.04 * points + 0.04 * (len(found) - 1))
    return label, round(confidence, 2), [s.reason for s in found], found


def suggest(text: str, indicators: IndicatorSet, sentiment_label: str | None = None) -> tuple[str, float, list[str]]:
    label, confidence, reasons, _ = suggest_with_signals(text, indicators, sentiment_label)
    return label, confidence, reasons
