"""Chooses the provider named in configuration. Adding a provider later = one entry here."""
from __future__ import annotations

from app.config import Settings
from app.knowledge.loader import KnowledgePack
from app.providers.base import AIProvider
from app.providers.local_rules import LocalRulesProvider
from app.utils.errors import ConfigurationError

AVAILABLE = ("local_rules",)


def build_provider(settings: Settings, pack: KnowledgePack) -> AIProvider:
    if settings.provider == "local_rules":
        return LocalRulesProvider(pack)
    raise ConfigurationError(f"Unknown AI_PROVIDER '{settings.provider}'. Available: {', '.join(AVAILABLE)}")
