"""One error envelope for every failure: {"error": {"code", "message", "requestId", "details"?}}.

Messages are fixed strings. Request text, stack traces and secrets are never included.
"""
from __future__ import annotations

from typing import Any


class ServiceError(Exception):
    """An error that maps directly to an HTTP response."""

    def __init__(self, status_code: int, code: str, message: str, *, headers: dict[str, str] | None = None, details: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers or {}
        self.details = details


class ProviderError(Exception):
    """A provider failed to produce a result. Reported as a controlled 502; the cause is logged, never returned."""


class ConfigurationError(Exception):
    """The service configuration (or a configured resource such as the intents file) is invalid."""


def envelope(code: str, message: str, request_id: str | None, details: Any = None) -> dict[str, Any]:
    body: dict[str, Any] = {"code": code, "message": message, "requestId": request_id}
    if details is not None:
        body["details"] = details
    return {"error": body}
