"""Service configuration, read once from environment variables.

Nothing here touches a database or the network. An invalid configuration does not crash the process: the service starts,
/ready reports the problems, and every intelligence endpoint answers 503 until it is fixed.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

MIN_TOKEN_LENGTH = 16
KNOWLEDGE_ROOT = Path(__file__).parent.parent / "knowledge" / "packs"
DEFAULT_PACK = "verification-support"
DEFAULT_INTENTS_FILE = KNOWLEDGE_ROOT / DEFAULT_PACK / "intents.json"  # the pack's own intents; INTENTS_FILE overrides them


def _int(name: str, default: int, problems: list[str], *, minimum: int = 0) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        problems.append(f"{name} must be an integer")
        return default
    if value < minimum:
        problems.append(f"{name} must be >= {minimum}")
        return default
    return value


@dataclass(frozen=True)
class Settings:
    service_token: str
    host: str = "127.0.0.1"
    port: int = 8100
    provider: str = "local_rules"
    max_body_bytes: int = 64 * 1024
    max_text_chars: int = 8000
    rate_limit_per_minute: int = 120  # 0 disables
    intents_file: Path | None = None
    log_level: str = "INFO"
    knowledge_root: Path = KNOWLEDGE_ROOT
    knowledge_pack: str = DEFAULT_PACK
    knowledge_require_approved: bool = False  # true: a draft pack keeps the service not ready
    reply_patterns_file: Path | None = None  # default: knowledge/replies/<pack>/replies.json next to the packs
    engine_components: str = ""  # optional "role=component,..." overrides, see app/engine/registry.py
    problems: tuple[str, ...] = ()

    @classmethod
    def from_env(cls) -> "Settings":
        problems: list[str] = []
        token = os.environ.get("INTERNAL_SERVICE_TOKEN", "").strip()
        if not token:
            problems.append("INTERNAL_SERVICE_TOKEN is not set")
        elif len(token) < MIN_TOKEN_LENGTH:
            problems.append(f"INTERNAL_SERVICE_TOKEN must be at least {MIN_TOKEN_LENGTH} characters")
            token = ""
        intents = os.environ.get("INTENTS_FILE", "").strip()
        return cls(
            service_token=token,
            host=os.environ.get("HOST", "127.0.0.1").strip() or "127.0.0.1",
            port=_int("PORT", 8100, problems, minimum=1),
            provider=os.environ.get("AI_PROVIDER", "local_rules").strip() or "local_rules",
            max_body_bytes=_int("MAX_BODY_BYTES", 64 * 1024, problems, minimum=1024),
            max_text_chars=_int("MAX_TEXT_CHARS", 8000, problems, minimum=1),
            rate_limit_per_minute=_int("RATE_LIMIT_PER_MINUTE", 120, problems),
            intents_file=Path(intents) if intents else None,
            log_level=os.environ.get("LOG_LEVEL", "INFO").strip().upper() or "INFO",
            knowledge_root=Path(os.environ.get("KNOWLEDGE_DIR", "").strip() or KNOWLEDGE_ROOT),
            knowledge_pack=os.environ.get("KNOWLEDGE_PACK", DEFAULT_PACK).strip() or DEFAULT_PACK,
            knowledge_require_approved=os.environ.get("KNOWLEDGE_REQUIRE_APPROVED", "").strip().lower() in ("1", "true", "yes"),
            reply_patterns_file=Path(os.environ["REPLY_PATTERNS_FILE"].strip()) if os.environ.get("REPLY_PATTERNS_FILE", "").strip() else None,
            engine_components=os.environ.get("ENGINE_COMPONENTS", "").strip(),
            problems=tuple(problems),
        )
