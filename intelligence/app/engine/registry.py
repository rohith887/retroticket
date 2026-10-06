"""Component registry: which implementation serves each role. Adding a trained model later = one entry here.

Selection is by name from configuration (ENGINE_COMPONENTS="sentiment=rules-sentiment,intent=rules-intent"); the default
for every role is the rules implementation. A trained component would load its model file from local disk in its factory.
"""
from __future__ import annotations

from typing import Callable

from app.engine import interfaces as I
from app.engine import reply as rules_reply
from app.engine.components import rules
from app.knowledge.loader import KnowledgePack
from app.utils.errors import ConfigurationError

ROLES = ("sentiment", "intent", "priority", "entity", "action", "outcome", "facts", "state")

REGISTRY: dict[str, dict[str, Callable[..., I.Component]]] = {
    "sentiment": {"rules-sentiment": lambda pack, parts: rules.RulesSentiment(pack)},
    "intent": {"rules-intent": lambda pack, parts: rules.RulesIntent(pack)},
    "priority": {"rules-priority": lambda pack, parts: rules.RulesPriority(pack)},
    "entity": {"rules-entity-extractor": lambda pack, parts: rules.PhraseMentionExtractor(pack, "entity")},
    "action": {"rules-action-extractor": lambda pack, parts: rules.PhraseMentionExtractor(pack, "action")},
    "outcome": {"rules-outcome-extractor": lambda pack, parts: rules.PhraseMentionExtractor(pack, "outcome")},
    "facts": {"rules-facts": lambda pack, parts: rules.RulesFactBuilder(pack, parts["intent"])},
    "state": {"rules-state": lambda pack, parts: rules.RulesStateDetector(pack)},
}


REPLY = {"rules-reply": lambda pack, knowledge, intent: rules_reply.RulesReplyGenerator(pack, knowledge, intent)}


def parse_selection(raw: str) -> dict[str, str]:
    selection: dict[str, str] = {}
    for item in (raw or "").split(","):
        item = item.strip()
        if not item:
            continue
        role, sep, name = item.partition("=")
        role, name = role.strip(), name.strip()
        known = REGISTRY.get(role) or (REPLY if role == "reply" else None)
        if not sep or known is None or name not in known:
            raise ConfigurationError(f"ENGINE_COMPONENTS: unknown component '{item}'")
        selection[role] = name
    return selection


def build_components(pack: KnowledgePack, selection_raw: str = "") -> dict[str, I.Component]:
    selection = parse_selection(selection_raw)
    parts: dict[str, I.Component] = {}
    for role in ROLES:
        name = selection.get(role) or next(iter(REGISTRY[role]))
        parts[role] = REGISTRY[role][name](pack, parts)
    return parts


def build_reply_service(pack: KnowledgePack, knowledge, components: dict[str, I.Component], selection_raw: str = ""):
    """The reply generator and its validator. Selected by name like every other component."""
    name = parse_selection(selection_raw).get("reply") or next(iter(REPLY))
    generator = REPLY[name](pack, knowledge, components["intent"])
    return rules_reply.ReplyService(generator, rules_reply.ReplyValidator(pack, knowledge), knowledge)
