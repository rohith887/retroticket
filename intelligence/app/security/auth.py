"""Internal service authentication: Authorization: Bearer <INTERNAL_SERVICE_TOKEN>.

Only the Node API knows the token. The comparison is constant-time and does not leak the token length (both sides are hashed
to a fixed size first).
"""
from __future__ import annotations

import hashlib
import hmac

from app.utils.errors import ServiceError


def _digest(value: str) -> bytes:
    return hashlib.sha256(value.encode("utf-8")).digest()


def token_matches(provided: str, expected: str) -> bool:
    return hmac.compare_digest(_digest(provided), _digest(expected))


def authenticate(authorization: str | None, expected_token: str) -> str:
    """Validate the header and return a stable, non-reversible caller id (used for rate limiting and logs)."""
    if not expected_token:
        # Misconfiguration must never turn into "open access".
        raise ServiceError(503, "service_not_configured", "The intelligence service is not configured.")
    if not authorization:
        raise ServiceError(401, "unauthorized", "Authentication is required.", headers={"WWW-Authenticate": "Bearer"})
    scheme, _, credential = authorization.partition(" ")
    if scheme.lower() != "bearer" or not credential.strip():
        raise ServiceError(401, "unauthorized", "Authentication is required.", headers={"WWW-Authenticate": "Bearer"})
    if not token_matches(credential.strip(), expected_token):
        raise ServiceError(403, "forbidden", "The service credential is not valid.")
    return _digest(credential.strip()).hex()[:12]
