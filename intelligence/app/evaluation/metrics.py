"""Raw counts only. No aggregate accuracy figure is produced: with a handful of proposed cases it would mean nothing."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Exact:
    """A single-label dimension: correct / evaluated."""

    correct: int = 0
    evaluated: int = 0

    def add(self, expected, actual) -> bool:
        self.evaluated += 1
        ok = expected == actual
        self.correct += ok
        return ok

    def to_dict(self):
        return {"correct": self.correct, "evaluated": self.evaluated}


@dataclass
class SetMatch:
    """A set dimension: true positives, false positives and false negatives, with precision/recall/F1 when defined."""

    tp: int = 0
    fp: int = 0
    fn: int = 0
    cases: int = 0

    def add(self, expected: set, actual: set) -> bool:
        self.cases += 1
        self.tp += len(expected & actual)
        self.fp += len(actual - expected)
        self.fn += len(expected - actual)
        return expected == actual

    def to_dict(self):
        p = self.tp / (self.tp + self.fp) if self.tp + self.fp else None
        r = self.tp / (self.tp + self.fn) if self.tp + self.fn else None
        f = 2 * p * r / (p + r) if p and r else (0.0 if p is not None and r is not None else None)

        def rnd(v):
            return None if v is None else round(v, 3)

        return {"cases": self.cases, "tp": self.tp, "fp": self.fp, "fn": self.fn, "precision": rnd(p), "recall": rnd(r), "f1": rnd(f)}
