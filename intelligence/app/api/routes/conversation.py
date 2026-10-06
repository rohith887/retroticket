"""POST /api/v1/analyze-conversation: the fact/state layer. Recommendations and evidence only; nothing is changed anywhere."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import CallContext, authorized, run
from app.api.schemas.conversation import ConversationRequest, ConversationResponse
from app.engine.model import ConversationInput, InputMessage, SystemEvent, TicketInput
from app.engine.snapshot import feature_snapshot
from app.engine.summary import build_summary
from app.utils.errors import ServiceError

router = APIRouter(prefix="/api/v1", tags=["intelligence"])


@router.post("/analyze-conversation", response_model=ConversationResponse)
def analyze_conversation(body: ConversationRequest, ctx: CallContext = Depends(authorized)):
    if ctx.pipeline is None:
        raise ServiceError(503, "service_not_configured", "The intelligence service is not configured.")
    total = sum(len(m.text) for m in body.messages)
    if any(len(m.text) > ctx.max_text_chars for m in body.messages):
        raise ServiceError(413, "payload_too_large", f"a message is longer than {ctx.max_text_chars} characters.")
    conversation = ConversationInput(
        ticket=TicketInput(body.ticket.status, body.ticket.priority, body.ticket.isResolved),
        messages=tuple(InputMessage(m.id, m.role, m.text, m.at) for m in body.messages),
        events=tuple(SystemEvent(e.id, e.type, e.at, e.data) for e in body.events),
        ticket_id=body.ticketId,
    )

    def work():
        a = ctx.pipeline.run(conversation)
        return a, feature_snapshot(a), build_summary(a, ctx.pipeline.pack)

    (analysis, snapshot, summary), meta = run("analyze-conversation", ctx, total, work)
    return ConversationResponse(
        engineVersion=analysis.engine_version,
        knowledge=analysis.knowledge,
        components=[c.to_dict() for c in analysis.components],
        sentiment={"label": analysis.sentiment.label, "confidence": analysis.sentiment.confidence, "component": analysis.sentiment.component.to_dict(), "signals": [{"group": g, "phrase": p, "points": pts} for g, p, pts in analysis.sentiment.signals]},
        intent={"label": analysis.intent.label, "confidence": analysis.intent.confidence, "component": analysis.intent.component.to_dict(), "alternatives": [{"label": l, "confidence": c} for l, c in analysis.intent.alternatives], "signals": [{"phrase": k, "points": pts} for k, pts in analysis.intent.signals]},
        priority={"label": analysis.priority.label, "confidence": analysis.priority.confidence, "component": analysis.priority.component.to_dict(), "reasons": list(analysis.priority.reasons), "signals": [{"group": g, "points": pts} for g, pts in analysis.priority.signals]},
        entities=[{"kind": m.kind, "id": m.id, "type": m.type, "polarity": m.polarity, "messageId": m.message_id, "sentenceIndex": m.sentence_index} for m in analysis.mentions],
        facts=[f.to_dict() for f in analysis.facts],
        pending=[p.to_dict() for p in analysis.pending],
        unrecognisedSentences=analysis.unrecognised_sentences,
        state=analysis.state.to_dict(),
        summary=summary,
        featureSnapshot=snapshot,
        meta=meta,
    )
