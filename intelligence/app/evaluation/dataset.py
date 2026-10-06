"""Golden-set loading. Expected results live in evaluation/golden/, never in the knowledge pack."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.engine.model import ConversationInput, InputMessage, SystemEvent, TicketInput

GOLDEN_DIR = Path(__file__).resolve().parent.parent.parent / "evaluation" / "golden"
DIMENSIONS = ("sentiment", "intent", "priority", "entities", "actions", "outcomes", "facts", "state", "parties")


@dataclass(frozen=True)
class Case:
    id: str
    source: str
    curation: str
    suitable: bool
    unsuitable_reason: str
    conversation: ConversationInput
    expected: dict[str, Any] = field(default_factory=dict)
    notes: str = ""


def to_conversation(raw: dict[str, Any]) -> ConversationInput:
    t = raw["ticket"]
    return ConversationInput(
        TicketInput(t["status"], t.get("priority"), bool(t.get("isResolved", False))),
        tuple(InputMessage(m["id"], m["role"], m["text"], m.get("at")) for m in raw["messages"]),
        tuple(SystemEvent(e["id"], e["type"], e.get("at"), e.get("data", {})) for e in raw.get("events", [])),
    )


def load_cases(path: Path | None = None) -> list[Case]:
    data = json.loads((path or GOLDEN_DIR / "cases.json").read_text(encoding="utf-8"))
    cases, seen = [], set()
    for c in data["cases"]:
        if c["id"] in seen:
            raise ValueError(f"duplicate case id {c['id']}")
        seen.add(c["id"])
        unknown = set(c.get("expected", {})) - set(DIMENSIONS)
        if unknown:
            raise ValueError(f"case {c['id']}: unknown expected keys {sorted(unknown)}")
        if c["source"] not in ("data-derived", "synthetic", "hand-written") or c["curation"] not in ("proposed", "reviewed"):
            raise ValueError(f"case {c['id']}: bad source or curation")
        if not c["suitable"] and not c.get("unsuitable_reason"):
            raise ValueError(f"case {c['id']}: an unsuitable case needs a reason")
        cases.append(Case(c["id"], c["source"], c["curation"], bool(c["suitable"]), c.get("unsuitable_reason", ""), to_conversation(c["conversation"]), c.get("expected", {}), c.get("notes", "")))
    return cases
