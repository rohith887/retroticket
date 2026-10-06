"""Structured, content-free logging: request id, operation, provider, latency, outcome. Never message text."""
from __future__ import annotations

import json
import logging
import re
import uuid

logger = logging.getLogger("intelligence")

_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


def configure(level: str = "INFO") -> None:
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
        logger.propagate = False
    logger.setLevel(getattr(logging, level, logging.INFO))


def request_id_from(header_value: str | None) -> str:
    """Accept a caller-supplied id only when it is a safe token; otherwise generate one."""
    if header_value and _REQUEST_ID.match(header_value):
        return header_value
    return uuid.uuid4().hex


def log_event(**fields) -> None:
    """One JSON line. Callers must only pass metadata (ids, labels, counts, timings)."""
    logger.info(json.dumps(fields, default=str, separators=(",", ":")))
