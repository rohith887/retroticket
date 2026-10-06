"""Replaceable component interfaces of the intelligence engine.

Every component exposes `info` (name and version) and returns explainable output (signals). The pipeline depends on these
interfaces only, so any single component can later be replaced by a trained model without touching routes, Node or the
other components:

    rules sentiment  ->  trained sentiment classifier      (SentimentAnalyzer)
    rules intent     ->  trained intent classifier         (IntentClassifier)
    rules priority   ->  trained priority model            (PriorityScorer)
    rules extraction ->  trained NER model                 (MentionExtractor)
    rules state      ->  learned state detector            (StateDetector)

A trained component would load its model file from disk at startup (no network, no external service) and is selected by name
in the component registry; the rules implementation stays available as the fallback.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from app.engine.reply_model import ReplyContext, ReplyDraft
from app.engine.model import (
    ComponentInfo,
    ConversationInput,
    Analysis,
    Fact,
    IntentOutput,
    Mention,
    PendingItem,
    PriorityOutput,
    ProcessedMessage,
    SentimentOutput,
    StateResult,
)


class Component(ABC):
    @property
    @abstractmethod
    def info(self) -> ComponentInfo: ...


class SentimentAnalyzer(Component):
    @abstractmethod
    def analyze(self, text: str) -> SentimentOutput: ...


class IntentClassifier(Component):
    @abstractmethod
    def classify(self, text: str) -> IntentOutput: ...

    @abstractmethod
    def score_sentence(self, text: str) -> tuple[str, int]:
        """(intent label, points) of the best non-fallback intent for one sentence; points 0 when nothing matched."""


class PriorityScorer(Component):
    @abstractmethod
    def score(self, text: str, sentiment_label: str | None = None) -> PriorityOutput: ...


class MentionExtractor(Component):
    """Finds mentions of one kind (entity, action or outcome) in the sentences of processed messages."""

    kind: str

    @abstractmethod
    def extract(self, messages: list[ProcessedMessage]) -> list[Mention]: ...


class FactBuilder(Component):
    @abstractmethod
    def build(self, conversation: ConversationInput, messages: list[ProcessedMessage], mentions: list[Mention]) -> tuple[list[Fact], list[PendingItem], int]:
        """Returns (facts, pending items, number of sentences the engine could not interpret)."""


class StateDetector(Component):
    @abstractmethod
    def detect(self, conversation: ConversationInput, messages: list[ProcessedMessage], facts: list[Fact]) -> StateResult: ...


class ReplyGenerator(Component):
    """Turns an analysis into an editable reply draft (or a structured refusal). Deterministic; never sends anything."""

    @abstractmethod
    def generate(self, analysis: Analysis, context: "ReplyContext") -> "ReplyDraft": ...
