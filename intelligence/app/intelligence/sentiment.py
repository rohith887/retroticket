"""Rule-based sentiment (engine component "rules-sentiment").

Labels: positive | neutral | negative | frustrated. The phrase groups come from the knowledge pack (indicators.json).

Points are counted from the pack's groups, with negation ("not good" counts as negative, not positive):
  positive points     strong phrase 2, weak phrase 1
  negative points     strong phrase 2, weak phrase 1
  frustration points  each repeat/anger phrase or "N times" pattern (weight from the pack, default 2); "!!" +1;
                      three or more ALL-CAPS words +1; "??" +1

Decision (first match wins):
  frustrated  frustration >= 2, or frustration >= 1 with negative >= 2
  negative    negative > positive
  positive    positive > negative
  neutral     no signals, or positive == negative

Confidence is the strength of the match, not a probability:
  frustrated  min(0.95, 0.60 + 0.05 * frustration + 0.02 * negative)
  negative    min(0.90, 0.50 + 0.08 * (negative - positive))
  positive    min(0.90, 0.50 + 0.08 * (positive - negative))
  neutral     0.50 when there are no signals at all, 0.40 when positive and negative cancel out
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.intelligence.text import clean, find, negated
from app.knowledge.loader import IndicatorSet

_CAPS_WORD = re.compile(r"\b[A-Z]{3,}\b")


@dataclass(frozen=True)
class SentimentSignals:
    positive: int = 0
    negative: int = 0
    frustration: int = 0
    # Explainability: (group id, matched phrase or rule, points). Phrases come from the knowledge pack, never from the message.
    matched: tuple[tuple[str, str, int], ...] = field(default_factory=tuple)


def score(text: str, indicators: IndicatorSet) -> SentimentSignals:
    original = clean(text)
    lower = original.lower()
    positive = negative = frustration = 0
    matched: list[tuple[str, str, int]] = []

    for group, weight in (("sentiment.positive_strong", 2), ("sentiment.positive_weak", 1)):
        for phrase in indicators.phrases(group):
            for m in find(lower, phrase):
                if negated(lower, m.start()):
                    negative += 1
                    matched.append((group, f"negated:{phrase}", 1))
                else:
                    positive += weight
                    matched.append((group, phrase, weight))
    for group, weight in (("sentiment.negative_strong", 2), ("sentiment.negative_weak", 1)):
        for phrase in indicators.phrases(group):
            hits = find(lower, phrase)
            if hits:
                points = weight * min(len(hits), 2)
                negative += points
                matched.append((group, phrase, points))
    weight = indicators.weight("frustration_phrase")
    for phrase in indicators.phrases("sentiment.frustration"):
        if find(lower, phrase):
            frustration += weight
            matched.append(("sentiment.frustration", phrase, weight))
    for pattern_id in ("frustration.times", "frustration.nth_time"):
        if indicators.pattern(pattern_id).search(lower):
            frustration += weight
            matched.append(("sentiment.frustration", pattern_id, weight))

    if "!!" in original:
        frustration += 1
        matched.append(("sentiment.frustration", "double exclamation", 1))
    if len(_CAPS_WORD.findall(original)) >= 3:
        frustration += 1
        matched.append(("sentiment.frustration", "shouting (all capitals)", 1))
    if "??" in original:
        frustration += 1
        matched.append(("sentiment.frustration", "double question mark", 1))
    return SentimentSignals(positive, negative, frustration, tuple(matched))


def decide(signals: SentimentSignals) -> tuple[str, float]:
    p, n, f = signals.positive, signals.negative, signals.frustration
    if f >= 2 or (f >= 1 and n >= 2):
        return "frustrated", round(min(0.95, 0.60 + 0.05 * f + 0.02 * n), 2)
    if n > p:
        return "negative", round(min(0.90, 0.50 + 0.08 * (n - p)), 2)
    if p > n:
        return "positive", round(min(0.90, 0.50 + 0.08 * (p - n)), 2)
    return "neutral", (0.40 if p == n and p > 0 else 0.50)


def analyze(text: str, indicators: IndicatorSet) -> tuple[str, float]:
    return decide(score(text, indicators))
