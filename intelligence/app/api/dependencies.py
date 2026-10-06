"""Shared request plumbing: service authentication, rate limiting and timing/error handling for every intelligence route."""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, TypeVar

from fastapi import Request

from app.api.schemas.analysis import Meta
from app.providers.base import AIProvider
from app.security.auth import authenticate
from app.utils.errors import ServiceError
from app.utils.logging import log_event

T = TypeVar("T")


@dataclass(frozen=True)
class CallContext:
    request_id: str
    caller: str
    provider: AIProvider
    max_text_chars: int
    pipeline: object | None = None
    reply: object | None = None


def authorized(request: Request) -> CallContext:
    """Dependency for the rule-based endpoints. /health and /ready do not use it."""
    state = request.app.state
    settings = state.settings
    provider = state.provider
    if settings.problems or provider is None:
        # A misconfigured service refuses to work instead of guessing.
        raise ServiceError(503, "service_not_configured", "The intelligence service is not configured.")
    caller = authenticate(request.headers.get("authorization"), settings.service_token)
    state.limiter.check(caller)
    return CallContext(request.state.request_id, caller, provider, settings.max_text_chars, state.pipeline, state.reply)


def check_text(ctx: CallContext, text: str) -> None:
    if len(text) > ctx.max_text_chars:
        raise ServiceError(413, "payload_too_large", f"text is longer than {ctx.max_text_chars} characters.")


def run(operation: str, ctx: CallContext, text_length: int, work: Callable[[], T]) -> tuple[T, Meta]:
    """Run provider work, time it, log metadata only, and turn any provider failure into a controlled 502."""
    started = time.perf_counter()
    info = ctx.provider.info
    try:
        result = work()
    except Exception as exc:  # noqa: BLE001 - the cause is logged by type only; it is never returned to the caller
        latency = round((time.perf_counter() - started) * 1000, 2)
        log_event(requestId=ctx.request_id, operation=operation, provider=info.name, model=info.model, latencyMs=latency, ok=False, error=type(exc).__name__)
        raise ServiceError(502, "provider_error", "The intelligence provider could not complete the request.") from exc
    latency = round((time.perf_counter() - started) * 1000, 2)
    log_event(requestId=ctx.request_id, operation=operation, provider=info.name, model=info.model, latencyMs=latency, ok=True, textChars=text_length, caller=ctx.caller)
    extra = {}
    if ctx.pipeline is not None:
        from app.engine.pipeline import ENGINE_VERSION

        extra = {"engineVersion": ENGINE_VERSION, "knowledge": ctx.pipeline.pack.fingerprint, "componentVersions": {i.name: i.version for i in ctx.pipeline.component_infos()}}
    return result, Meta(provider=info.name, model=info.model, version=info.version, latencyMs=latency, requestId=ctx.request_id, **extra)
