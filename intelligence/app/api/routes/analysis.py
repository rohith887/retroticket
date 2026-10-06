"""Version 1 intelligence endpoints. Each one: authenticate -> validate -> provider -> response. No rules live here."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import CallContext, authorized, check_text, run
from app.api.schemas.analysis import (
    AnalyzeMessageResponse,
    IntentAlternative,
    IntentOut,
    IntentResponse,
    IntentsResponse,
    MessageRequest,
    PriorityOut,
    PriorityResponse,
    SentimentOut,
    SentimentResponse,
)
from app.providers.base import IntentResult, PriorityResult, SentimentResult

router = APIRouter(prefix="/api/v1", tags=["intelligence"])


def _sentiment(r: SentimentResult) -> SentimentOut:
    return SentimentOut(label=r.label, confidence=r.confidence)


def _intent(r: IntentResult) -> IntentOut:
    return IntentOut(label=r.label, confidence=r.confidence, alternatives=[IntentAlternative(label=l, confidence=c) for l, c in r.alternatives])


def _priority(r: PriorityResult) -> PriorityOut:
    return PriorityOut(label=r.label, confidence=r.confidence, reasons=list(r.reasons))


@router.post("/analyze-message", response_model=AnalyzeMessageResponse)
def analyze_message(body: MessageRequest, ctx: CallContext = Depends(authorized)):
    """Sentiment, intent and a priority suggestion for one message. Recommendations only: nothing is changed anywhere."""
    check_text(ctx, body.text)
    result, meta = run("analyze-message", ctx, len(body.text), lambda: ctx.provider.analyze_message(body.text))
    return AnalyzeMessageResponse(sentiment=_sentiment(result.sentiment), intent=_intent(result.intent), priority=_priority(result.priority), meta=meta)


@router.post("/sentiment", response_model=SentimentResponse)
def sentiment(body: MessageRequest, ctx: CallContext = Depends(authorized)):
    check_text(ctx, body.text)
    result, meta = run("sentiment", ctx, len(body.text), lambda: ctx.provider.analyze_sentiment(body.text))
    return SentimentResponse(sentiment=_sentiment(result), meta=meta)


@router.post("/intent", response_model=IntentResponse)
def intent(body: MessageRequest, ctx: CallContext = Depends(authorized)):
    check_text(ctx, body.text)
    result, meta = run("intent", ctx, len(body.text), lambda: ctx.provider.classify_intent(body.text))
    return IntentResponse(intent=_intent(result), meta=meta)


@router.post("/priority", response_model=PriorityResponse)
def priority(body: MessageRequest, ctx: CallContext = Depends(authorized)):
    """A priority RECOMMENDATION. The caller decides whether to apply it."""
    check_text(ctx, body.text)
    result, meta = run("priority", ctx, len(body.text), lambda: ctx.provider.suggest_priority(body.text))
    return PriorityResponse(priority=_priority(result), meta=meta)


@router.get("/intents", response_model=IntentsResponse)
def intents(ctx: CallContext = Depends(authorized)):
    """The intent categories currently configured."""
    result, meta = run("intents", ctx, 0, ctx.provider.intents)
    return IntentsResponse(intents=result, meta=meta)
