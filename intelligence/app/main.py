"""Intelligence service entry point.

Python here is an intelligence service, not the owner of ticketing logic: it receives text, returns insights, and never
reads or writes the ticket system. Start with:  uvicorn app.main:app --host 127.0.0.1 --port 8100
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import analysis, conversation, health, reply
from app.config import Settings
from app.providers.base import AIProvider
from app.engine.pipeline import Pipeline
from app.engine.registry import build_reply_service
from app.knowledge.loader import load_pack
from app.knowledge.reply import load_reply_knowledge
from app.providers.registry import build_provider
from app.security.limits import BodyLimitMiddleware, RateLimiter
from app.utils import logging as log
from app.utils.errors import ConfigurationError, ServiceError, envelope

VERSION = "0.1.0"


def create_app(settings: Settings | None = None, provider: AIProvider | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    log.configure(settings.log_level)

    app = FastAPI(title="Ticketer intelligence service", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.limiter = RateLimiter(settings.rate_limit_per_minute)
    app.state.provider = provider
    app.state.provider_error = None
    app.state.pack = None
    app.state.pipeline = None
    app.state.reply = None
    # Knowledge is loaded and validated once at startup. An invalid pack does not crash the process: /health stays up,
    # /ready explains, and every intelligence route answers 503 until the pack is fixed.
    try:
        pack = load_pack(settings.knowledge_root / settings.knowledge_pack, require_approved=settings.knowledge_require_approved, intents_file=settings.intents_file)
        app.state.pack = pack
        app.state.pipeline = Pipeline.build(pack, settings.engine_components)
        reply_file = settings.reply_patterns_file or settings.knowledge_root.parent / "replies" / settings.knowledge_pack / "replies.json"
        reply_knowledge = load_reply_knowledge(reply_file, pack, check_intents=settings.intents_file is None)
        app.state.reply = build_reply_service(pack, reply_knowledge, app.state.pipeline.components, settings.engine_components)
        if provider is None:
            app.state.provider = build_provider(settings, pack)
    except ConfigurationError as exc:  # KnowledgeError is a ConfigurationError
        app.state.provider_error = str(exc)
        log.log_event(event="engine_unavailable", reason=str(exc))

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        request.state.request_id = log.request_id_from(request.headers.get("x-request-id"))
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    def rid(request: Request) -> str | None:
        return getattr(request.state, "request_id", None)

    @app.exception_handler(ServiceError)
    async def service_error(request: Request, exc: ServiceError):
        return JSONResponse(status_code=exc.status_code, headers=exc.headers, content=envelope(exc.code, exc.message, rid(request), exc.details))

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Report where and why, never what was sent (the payload is customer text).
        details = [{"field": ".".join(str(p) for p in err["loc"] if p != "body"), "message": err["msg"]} for err in exc.errors()]
        return JSONResponse(status_code=422, content=envelope("validation_error", "The request is not valid.", rid(request), details))

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return JSONResponse(status_code=exc.status_code, content=envelope(code, "The request could not be handled.", rid(request)))

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception):
        log.log_event(requestId=rid(request), event="unhandled_error", error=type(exc).__name__)
        return JSONResponse(status_code=500, content=envelope("internal_error", "Internal server error.", rid(request)))

    app.include_router(health.router)
    app.include_router(analysis.router)
    app.include_router(conversation.router)
    app.include_router(reply.router)
    app.add_middleware(BodyLimitMiddleware, max_bytes=settings.max_body_bytes)
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=app.state.settings.host, port=app.state.settings.port)
