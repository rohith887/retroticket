"""POST /api/v1/reply-draft: an editable reply draft (or a structured refusal). Never sends anything, never changes anything."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import CallContext, authorized, run
from app.api.schemas.conversation import ReplyRequest, ReplyResponse
from app.engine.model import ConversationInput, InputMessage, SystemEvent, TicketInput
from app.engine.reply_model import ReplyContext
from app.engine.snapshot import feature_snapshot
from app.utils.errors import ServiceError

router = APIRouter(prefix="/api/v1", tags=["intelligence"])


@router.post("/reply-draft", response_model=ReplyResponse)
def reply_draft(body: ReplyRequest, ctx: CallContext = Depends(authorized)):
    if ctx.pipeline is None or ctx.reply is None:
        raise ServiceError(503, "service_not_configured", "The intelligence service is not configured.")
    # Internal notes must never take part in drafting a customer reply, and there is no override.
    if any(m.role == "internal_note" for m in body.messages):
        raise ServiceError(422, "internal_notes_not_allowed", "Internal notes cannot be used to draft a reply.")
    if any(len(m.text) > ctx.max_text_chars for m in body.messages):
        raise ServiceError(413, "payload_too_large", f"a message is longer than {ctx.max_text_chars} characters.")
    conversation = ConversationInput(
        ticket=TicketInput(body.ticket.status, body.ticket.priority, body.ticket.isResolved),
        messages=tuple(InputMessage(m.id, m.role, m.text, m.at) for m in body.messages),
        events=tuple(SystemEvent(e.id, e.type, e.at, e.data) for e in body.events),
        ticket_id=body.ticketId,
    )
    context = ReplyContext(body.sequence.basedOn, body.sequence.current) if body.sequence else ReplyContext()

    def work():
        analysis = ctx.pipeline.run(conversation)
        draft = ctx.reply.run(analysis, context)
        snapshot = feature_snapshot(analysis)
        ready = draft.status == "ready"
        snapshot["reply"] = {
            "status": draft.status,
            "reason": draft.reason,
            "sentences": len(draft.sentences) if ready else 0,
            "patterns": [s.source.pattern_id for s in draft.sentences] if ready else [],
        }
        return analysis, draft, snapshot

    (analysis, draft, snapshot), meta = run("reply-draft", ctx, sum(len(m.text) for m in body.messages), work)
    return ReplyResponse(
        engineVersion=analysis.engine_version,
        knowledge=analysis.knowledge,
        replyKnowledge=ctx.reply.knowledge.summary(),
        components=[c.to_dict() for c in analysis.components] + [draft.generator.to_dict()],
        replyDraft=draft.to_dict(),
        state=analysis.state.to_dict(),
        featureSnapshot=snapshot,
        meta=meta,
    )
