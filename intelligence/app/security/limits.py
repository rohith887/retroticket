"""Request limits: body size (pure ASGI middleware) and a small in-memory rate limiter.

The rate limiter is per process. That is enough for one Node API calling one intelligence service; a multi-instance
deployment would put the limit in front of the service instead of adding shared state here.
"""
from __future__ import annotations

import json
import time
from collections import defaultdict, deque

from app.utils.errors import ServiceError, envelope


class BodyLimitMiddleware:
    """Rejects request bodies over `max_bytes` with 413 before the application reads them.

    Checks Content-Length up front, and counts streamed bytes for requests that do not declare one.
    """

    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        declared = headers.get(b"content-length")
        if declared is not None:
            try:
                if int(declared) > self.max_bytes:
                    return await self._reject(scope, send)
            except ValueError:
                return await self._reject(scope, send, status=400, code="bad_request", message="Invalid Content-Length header.")

        received = 0
        responded = False

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _TooLarge()
            return message

        async def tracking_send(message):
            nonlocal responded
            if message["type"] == "http.response.start":
                responded = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _TooLarge:
            if not responded:
                await self._reject(scope, send)

    async def _reject(self, scope, send, status: int = 413, code: str = "payload_too_large", message: str | None = None):
        request_id = scope.get("state", {}).get("request_id")
        body = json.dumps(envelope(code, message or "The request body is too large.", request_id)).encode()
        await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


class _TooLarge(Exception):
    pass


class RateLimiter:
    """Sliding one-minute window per caller. `limit == 0` disables it."""

    def __init__(self, limit_per_minute: int, clock=time.monotonic):
        self.limit = limit_per_minute
        self.clock = clock
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, caller: str) -> None:
        if self.limit <= 0:
            return
        now = self.clock()
        hits = self._hits[caller]
        while hits and now - hits[0] >= 60:
            hits.popleft()
        if len(hits) >= self.limit:
            retry_after = max(1, int(60 - (now - hits[0])))
            raise ServiceError(429, "rate_limited", "Too many requests.", headers={"Retry-After": str(retry_after)})
        hits.append(now)
