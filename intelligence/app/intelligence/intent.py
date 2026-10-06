"""Rule-based, configurable intent classification.

The categories live in a JSON file (see intents.default.json / INTENTS_FILE), not in code. Each intent has weighted keyword
phrases. For a message:

  score(intent) = sum over its phrases of weight * min(occurrences, 2)
  winner        = highest score; ties go to the intent listed first in the file (deterministic)
  no matches    = the fallback intent ("other")

Confidence is match strength, not a probability:

  fallback (nothing matched)        0.30
  single weak signal (score <= 1)   0.50
  otherwise  min(0.92, 0.45 + 0.08 * min(score, 5) + 0.05 * min(margin, 3))   where margin = winner score - runner-up score

A tie between two intents therefore gets a lower confidence than a clear winner, and the runner-ups are returned as
`alternatives` so the caller can see that the message carried several signals.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.intelligence.text import clean, find
from app.knowledge.schema import Origin, Review
from app.utils.errors import ConfigurationError

_LABEL = r"^[a-z][a-z0-9_]{1,47}$"


class Keyword(BaseModel):
    model_config = ConfigDict(extra="forbid")
    phrase: str = Field(min_length=1, max_length=80)
    weight: int = Field(default=1, ge=1, le=3)


class IntentDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(pattern=_LABEL)
    description: str = Field(default="", max_length=200)
    keywords: list[Keyword] = Field(default_factory=list)
    fallback: bool = False
    # Knowledge-pack review information (optional for hand-written override files).
    origin: Origin | None = None
    review: Review | None = None
    note: str = Field(default="", max_length=400)


@dataclass(frozen=True)
class IntentScore:
    label: str
    score: int
    matched: tuple[tuple[str, int], ...] = ()  # (keyword phrase, points): why this score


class IntentCatalog:
    """A validated set of intent definitions."""

    def __init__(self, definitions: list[IntentDefinition]):
        if not definitions:
            raise ConfigurationError("The intents file defines no intents.")
        labels = [d.label for d in definitions]
        if len(set(labels)) != len(labels):
            raise ConfigurationError("Intent labels must be unique.")
        fallbacks = [d for d in definitions if d.fallback]
        if len(fallbacks) != 1:
            raise ConfigurationError("Exactly one intent must be marked fallback: true.")
        self.definitions = definitions
        self.fallback = fallbacks[0]

    @classmethod
    def load(cls, path: Path) -> "IntentCatalog":
        try:
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
            items = raw["intents"] if isinstance(raw, dict) else raw
            return cls([IntentDefinition.model_validate(item) for item in items])
        except (OSError, ValueError, KeyError, TypeError, ValidationError) as exc:
            # The cause can name a file path; keep it short and free of file contents.
            raise ConfigurationError(f"Could not load intents from {Path(path).name}: {type(exc).__name__}") from exc

    def public(self) -> list[dict[str, str]]:
        return [{"label": d.label, "description": d.description} for d in self.definitions]


def score_all(text: str, catalog: IntentCatalog) -> list[IntentScore]:
    lower = clean(text).lower()
    scores: list[IntentScore] = []
    for definition in catalog.definitions:
        total = 0
        matched = []
        for keyword in definition.keywords:
            points = keyword.weight * min(len(find(lower, keyword.phrase)), 2)
            if points:
                matched.append((keyword.phrase, points))
            total += points
        scores.append(IntentScore(definition.label, total, tuple(matched)))
    return scores


def classify(text: str, catalog: IntentCatalog) -> tuple[str, float, list[tuple[str, float]]]:
    """Returns (label, confidence, alternatives) with alternatives = [(label, confidence), ...] for other matched intents."""
    scores = score_all(text, catalog)
    ranked = sorted(range(len(scores)), key=lambda i: (-scores[i].score, i))  # stable: file order breaks ties
    top = scores[ranked[0]]
    if top.score == 0:
        return catalog.fallback.label, 0.30, []

    runner_up = scores[ranked[1]].score if len(ranked) > 1 else 0
    margin = top.score - runner_up
    if top.score <= 1:
        confidence = 0.50
    else:
        confidence = min(0.92, 0.45 + 0.08 * min(top.score, 5) + 0.05 * min(margin, 3))

    alternatives = []
    for index in ranked[1:3]:
        other = scores[index]
        if other.score > 0:
            alternatives.append((other.label, round(min(0.92, 0.45 + 0.08 * min(other.score, 5)) if other.score > 1 else 0.40, 2)))
    return top.label, round(confidence, 2), alternatives
