"""The engine pipeline: Knowledge -> Preprocessing -> Features -> Extraction -> Facts -> State (+ sentiment, intent, priority).

Deterministic and side-effect free: no network, no database, no clock, no randomness.
"""
from __future__ import annotations

from app.engine import interfaces as I
from app.engine.model import Analysis, ConversationInput
from app.engine.preprocess import preprocess
from app.engine.registry import ROLES, build_components
from app.knowledge.loader import KnowledgePack

ENGINE_VERSION = "3a.1"


class Pipeline:
    def __init__(self, pack: KnowledgePack, components: dict[str, I.Component]):
        self.pack = pack
        self.components = components

    @classmethod
    def build(cls, pack: KnowledgePack, selection: str = "") -> "Pipeline":
        return cls(pack, build_components(pack, selection))

    def component_infos(self):
        return tuple(self.components[r].info for r in ROLES)

    def run(self, conversation: ConversationInput) -> Analysis:
        c = self.components
        messages = preprocess(conversation, self.pack.indicators)

        # Sentiment, intent and priority describe what the customer wrote, so they read customer messages only.
        customer_text = "\n".join(m.text for m in messages if m.party == "customer")
        sentiment = c["sentiment"].analyze(customer_text)
        intent = c["intent"].classify(customer_text)
        priority = c["priority"].score(customer_text, sentiment.label)

        mentions = []
        for role in ("entity", "action", "outcome"):
            mentions += c[role].extract(messages)
        mentions.sort(key=lambda m: (m.message_id, m.sentence_index, m.start, m.kind))

        facts, pending, unrecognised = c["facts"].build(conversation, messages, mentions)
        state = c["state"].detect(conversation, messages, facts)
        return Analysis(ENGINE_VERSION, self.pack.summary(), self.component_infos(), tuple(messages), sentiment, intent, priority, tuple(mentions), tuple(facts), tuple(pending), state, unrecognised)
