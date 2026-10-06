from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """Liveness: the process is up. No authentication, no dependencies checked."""
    return {"status": "ok"}


@router.get("/ready")
def ready(request: Request):
    """Readiness: configuration is valid and the provider is built. 503 with the reasons when it is not."""
    state = request.app.state
    problems = list(state.settings.problems)
    if (state.provider is None or state.pipeline is None) and state.provider_error:
        problems.append(state.provider_error)
    if problems:
        return JSONResponse(status_code=503, content={"status": "not_ready", "problems": problems})
    info = state.provider.info
    body = {"status": "ready", "provider": info.name, "version": info.version, "intents": len(state.provider.intents())}
    if state.pipeline is not None:
        from app.engine.pipeline import ENGINE_VERSION

        body["engine"] = {"version": ENGINE_VERSION, "knowledge": state.pack.summary(), "components": [c.to_dict() for c in state.pipeline.component_infos()]}
        if state.reply is not None:
            body["engine"]["replyKnowledge"] = state.reply.knowledge.summary()
    return body
