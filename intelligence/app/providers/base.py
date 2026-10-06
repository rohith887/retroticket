"""The provider contract. Routes talk to an AIProvider and know nothing about how it works.

A trained local model would implement the same interface; the HTTP API and the Node contract do not change.
The engine components in app/engine cover the richer, conversation-level analysis.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass(frozen=True)
class SentimentResult:
    label: str
    confidence: float


@dataclass(frozen=True)
class IntentResult:
    label: str
    confidence: float
    alternatives: tuple[tuple[str, float], ...] = ()


@dataclass(frozen=True)
class PriorityResult:
    label: str
    confidence: float
    reasons: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class MessageAnalysis:
    sentiment: SentimentResult
    intent: IntentResult
    priority: PriorityResult


@dataclass(frozen=True)
class ProviderInfo:
    name: str
    model: str
    version: str


class AIProvider(ABC):
    """Every method receives plain text and returns plain results. Providers must not touch the ticket system."""

    @property
    @abstractmethod
    def info(self) -> ProviderInfo: ...

    @abstractmethod
    def analyze_sentiment(self, text: str) -> SentimentResult: ...

    @abstractmethod
    def classify_intent(self, text: str) -> IntentResult: ...

    @abstractmethod
    def suggest_priority(self, text: str) -> PriorityResult: ...

    def analyze_message(self, text: str) -> MessageAnalysis:
        """All three at once. Providers may override this to share work between the three analyses."""
        return MessageAnalysis(self.analyze_sentiment(text), self.classify_intent(text), self.suggest_priority(text))

    def intents(self) -> list[dict[str, str]]:
        """The intent categories this provider can return (label + description)."""
        return []
