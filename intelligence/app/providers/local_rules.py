"""The rule-based provider for single-message analysis, built from the knowledge pack.

Deterministic: the same input always gives the same output. No model, no network, no database, no external service.
Confidence values describe how strong the rule match was; they are NOT calibrated probabilities.
"""
from __future__ import annotations

from app.engine.components.rules import RulesIntent, RulesPriority, RulesSentiment
from app.knowledge.loader import KnowledgePack
from app.providers.base import AIProvider, IntentResult, MessageAnalysis, PriorityResult, ProviderInfo, SentimentResult

RULES_VERSION = "1.0"


class LocalRulesProvider(AIProvider):
    def __init__(self, pack: KnowledgePack):
        self._pack = pack
        self._sentiment = RulesSentiment(pack)
        self._intent = RulesIntent(pack)
        self._priority = RulesPriority(pack)

    @property
    def info(self) -> ProviderInfo:
        return ProviderInfo(name="local_rules", model="rules-lexicon", version=RULES_VERSION)

    def analyze_sentiment(self, text: str) -> SentimentResult:
        s = self._sentiment.analyze(text)
        return SentimentResult(s.label, s.confidence)

    def classify_intent(self, text: str) -> IntentResult:
        i = self._intent.classify(text)
        return IntentResult(i.label, i.confidence, i.alternatives)

    def suggest_priority(self, text: str) -> PriorityResult:
        p = self._priority.score(text)
        return PriorityResult(p.label, p.confidence, p.reasons)

    def analyze_message(self, text: str) -> MessageAnalysis:
        s = self._sentiment.analyze(text)
        p = self._priority.score(text, s.label)
        i = self._intent.classify(text)
        return MessageAnalysis(SentimentResult(s.label, s.confidence), IntentResult(i.label, i.confidence, i.alternatives), PriorityResult(p.label, p.confidence, p.reasons))

    def intents(self) -> list[dict[str, str]]:
        return self._pack.intents.public()
