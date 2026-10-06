import json
import shutil
import socket
import sys
from dataclasses import replace

import pytest

from app.config import DEFAULT_PACK, KNOWLEDGE_ROOT
from app.engine.model import ConversationInput, InputMessage, SystemEvent, TicketInput
from app.engine.pipeline import Pipeline
from app.engine.registry import build_reply_service
from app.engine.reply_model import ReplyContext, ReplyDraft, ReplySentence, Source
from app.knowledge.loader import KnowledgeError, load_pack
from app.knowledge.reply import load_reply_knowledge

REPLY_FILE = KNOWLEDGE_ROOT.parent / "replies" / DEFAULT_PACK / "replies.json"


@pytest.fixture(scope="module")
def pack():
    return load_pack(KNOWLEDGE_ROOT / DEFAULT_PACK)


@pytest.fixture(scope="module")
def knowledge(pack):
    return load_reply_knowledge(REPLY_FILE, pack)


@pytest.fixture(scope="module")
def pipeline(pack):
    return Pipeline.build(pack)


@pytest.fixture(scope="module")
def service(pack, knowledge, pipeline):
    return build_reply_service(pack, knowledge, pipeline.components)


def conv(*messages, status="open", resolved=False, events=()):
    return ConversationInput(TicketInput(status, None, resolved), tuple(InputMessage(f"m{i + 1}", role, text) for i, (role, text) in enumerate(messages)), tuple(events))


def draft(pipeline, service, *messages, context=None, **kw):
    analysis = pipeline.run(conv(*messages, **kw))
    return service.run(analysis, context or ReplyContext()), analysis


def texts(d):
    return [s.text for s in d.sentences]


# --- what is said, and what is not ------------------------------------------------------------------------------------------------
def test_customer_claim_becomes_a_hedged_acknowledgement_never_our_action(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "I submitted my passport three times and it was rejected. There is a document issue."))
    assert d.status == "ready"
    assert "You mentioned that you submitted your passport three times and that it was rejected." in texts(d)
    joined = d.body.lower()
    for forbidden in ("we rejected", "we received", "has been received", "will be", "we will"):
        assert forbidden not in joined


def test_claim_never_becomes_a_verified_fact(pipeline, service):
    d, analysis = draft(pipeline, service, ("customer", "I sent the certificate. It was rejected. There is a document issue."))
    claim_sentences = [s for s in d.sentences if s.source.type == "claim"]
    assert claim_sentences and all(s.source.type != "verified_fact" for s in claim_sentences)
    by_id = {f.id: f for f in analysis.facts}
    assert all(by_id[fid].kind == "claim" for s in claim_sentences for fid in s.source.fact_ids)
    assert not any("received" in t and t.startswith("We") for t in texts(d))


def test_verified_ticket_status_is_stated_plainly_for_a_status_request(pipeline, service):
    d, analysis = draft(pipeline, service, ("customer", "Any update on this?"), status="in_progress")
    verified = [s for s in d.sentences if s.source.type == "verified_fact"]
    assert [s.text for s in verified] == ["Our records show this ticket as in progress."]
    fact = next(f for f in analysis.facts if f.id == verified[0].source.fact_ids[0])
    assert fact.kind == "verified" and fact.field == "status"


def test_internal_notes_are_excluded_from_the_draft(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "There is a problem with my document."), ("internal_note", "The customer passport was rejected three times, escalate to Ravi."))
    assert d.status == "ready"
    assert "passport" not in d.body and "Ravi" not in d.body


def test_automated_mail_is_excluded(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "Your one-time password is 123456. Do not share this OTP."))
    assert d.status == "insufficient_context" and d.reason == "no_customer_message"


# --- refusals ---------------------------------------------------------------------------------------------------------------------------
def test_missing_entity_gets_a_clarifying_question_and_no_invented_claim(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "There is a problem with my document."))
    assert d.status == "ready"
    assert any("which document" in t for t in texts(d))
    assert not any(s.source.type == "claim" for s in d.sentences)


def service_with_patterns(pack, knowledge, pipeline):
    return build_reply_service(pack, knowledge, pipeline.components)


def test_missing_entity_falls_back_when_no_clarifying_pattern_exists(pack, pipeline, knowledge):
    file = knowledge.file.model_copy(update={"patterns": [p for p in knowledge.file.patterns if not p.id.startswith("ask.")], "intents": {k: v.model_copy(update={"steps": [s for s in v.steps if not s.startswith("ask_")]}) for k, v in knowledge.file.intents.items()}})
    stripped = replace(knowledge, file=file)
    svc = build_reply_service(pack, stripped, pipeline.components)
    analysis = pipeline.run(conv(("customer", "There is a problem with my document.")))
    analysis = replace(analysis, mentions=tuple(m for m in analysis.mentions if m.kind != "entity"))  # nothing specific was named
    d = svc.run(analysis, ReplyContext())
    assert d.status == "insufficient_context" and d.reason == "missing_entity"
    with_pattern = service_with_patterns(pack, knowledge, pipeline).run(analysis, ReplyContext())
    assert with_pattern.status == "ready" and any("which document or verification" in t for t in texts(with_pattern))


def test_unknown_intent_is_refused(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "Please note the following."))
    assert d.status == "insufficient_context" and d.reason in ("unknown_intent", "ambiguous_state")
    d2, _ = draft(pipeline, service, ("customer", "Hello, please help."))
    assert d2.status == "insufficient_context"


def test_unsupported_request_is_refused(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "The website is not working, error on login."))
    assert d.status == "insufficient_context" and d.reason in ("unsupported_request", "unknown_intent")
    assert d.body == ""


def test_ambiguous_state_is_refused(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "Any update on this?"), ("agent", "Please upload the passport."))
    assert d.status == "insufficient_context" and d.reason in ("ambiguous_state", "no_customer_message")
    resolved, _ = draft(pipeline, service, ("customer", "Any update on this?"), status="resolved", resolved=True)
    assert resolved.reason == "ambiguous_state" and resolved.detail == "resolved"


def test_only_the_latest_turn_is_answered(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "My passport was rejected."), ("agent", "Please upload a clearer copy."), ("customer", "Any update on this?"))
    assert d.status == "ready" and "passport" not in d.body


# --- determinism, ordering, provenance ------------------------------------------------------------------------------------------------
def test_multiple_claims_are_ordered_by_message_and_sentence_and_capped(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "I uploaded the marksheet. It was rejected. I sent the transcript twice. I have not received the certificate. I submitted the passport. There is a document issue."))
    claims = [s for s in d.sentences if s.source.type == "claim"]
    assert 1 <= len(claims) <= 3
    positions = [(s.source.message_id, s.source.sentence_index) for s in claims]
    assert positions == sorted(positions)


def test_every_sentence_has_provenance(pipeline, service):
    d, analysis = draft(pipeline, service, ("customer", "I submitted my passport three times and it was rejected. Can you check this document issue?"), status="open")
    ids = {f.id for f in analysis.facts}
    for s in d.sentences:
        assert s.source.type in ("claim", "verified_fact", "pattern") and s.source.pattern_id
        if s.source.type in ("claim", "verified_fact"):
            assert s.source.fact_ids and set(s.source.fact_ids) <= ids
        if s.source.type == "claim":
            assert s.source.message_id == "m1" and s.source.sentence_index is not None
    assert json.dumps(d.to_dict())  # serialisable


def test_draft_is_deterministic(pipeline, service):
    m = ("customer", "I submitted my passport three times and it was rejected. There is a document issue.")
    a, _ = draft(pipeline, service, m)
    b, _ = draft(pipeline, service, m)
    assert a.to_dict() == b.to_dict()


def test_no_invented_dates_promises_outcomes_or_contact_data(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "I sent the document yesterday. Please reply by tomorrow at 555-123-4567 or jane@example.com. There is an issue with my document."))
    body = d.body.lower()
    for word in ("yesterday", "tomorrow", "555", "jane", "@", "http", "refund", "approved", "guarantee", "within", "soon", "days"):
        assert word not in body
    assert d.status == "ready"


def test_raw_customer_text_never_appears_in_the_draft(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "My passport was rejected, my mobile is 98765 43210 and my email jane@example.com. There is a document issue."))
    assert "98765" not in json.dumps(d.to_dict()) and "jane" not in json.dumps(d.to_dict())


# --- validator: fails closed ------------------------------------------------------------------------------------------------------------------
def unsafe(service, analysis, text, source, context=None):
    d = ReplyDraft("ready", service.generator.info, service.knowledge.fingerprint, sentences=(ReplySentence(text, source),))
    return service.validator.validate(d, analysis, context or ReplyContext())


def test_validator_rejects_unsafe_sentences(pipeline, service):
    analysis = pipeline.run(conv(("customer", "I submitted my passport and it was rejected.")))
    fact = next(f for f in analysis.facts if f.kind == "claim" and f.entity)
    claim = Source("claim", "claim.action_outcome", (fact.id,), "m1", 0)
    cases = {
        "We received your passport and it will be approved within 3 days.": "forbidden_phrase",
        "You mentioned that your passport was rejected on 12 March.": "date_or_number",
        "You mentioned that your passport was rejected. See www.example.org": "link_or_address",
        "You mentioned that your passport was approved.": "unsupported_claim",
        "You mentioned that your certificate was rejected.": "unsupported_claim",
        "Your passport was rejected.": "claim_not_hedged",
        "You mentioned that {{customer_name}} was rejected.": "internal_marker",
        "You mentioned that we will process a refund for your passport.": "forbidden_phrase",
    }
    for text, check in cases.items():
        assert check in {f["check"] for f in unsafe(service, analysis, text, claim)}, text


def test_validator_rejects_missing_sources_wrong_fact_kinds_and_tampered_patterns(pipeline, service):
    analysis = pipeline.run(conv(("customer", "I submitted my passport and it was rejected.")))
    fact = next(f for f in analysis.facts if f.kind == "claim" and f.entity)
    assert "claim_without_claim_fact" in {f["check"] for f in unsafe(service, analysis, "You mentioned that your passport was rejected.", Source("claim", "x", ("nope",)))}
    status = next(f for f in analysis.facts if f.kind == "verified")
    assert "claim_without_claim_fact" in {f["check"] for f in unsafe(service, analysis, "You mentioned that your passport was rejected.", Source("claim", "x", (status.id,)))}
    assert "verified_without_verified_fact" in {f["check"] for f in unsafe(service, analysis, "Our records show this ticket as open.", Source("verified_fact", "x", (fact.id,)))}
    assert "pattern_mismatch" in {f["check"] for f in unsafe(service, analysis, "Thank you. Your case is approved.", Source("pattern", "opening"))}


def test_validator_rejects_empty_long_and_stale_drafts(pipeline, service):
    analysis = pipeline.run(conv(("customer", "Any update on this?")))
    empty = ReplyDraft("ready", service.generator.info, service.knowledge.fingerprint)
    assert "empty_draft" in {f["check"] for f in service.validator.validate(empty, analysis, ReplyContext())}
    opening = Source("pattern", "opening")
    many = ReplyDraft("ready", service.generator.info, service.knowledge.fingerprint, sentences=tuple(ReplySentence("Thank you for your message.", opening) for _ in range(9)))
    assert "too_many_sentences" in {f["check"] for f in service.validator.validate(many, analysis, ReplyContext())}
    ok = ReplyDraft("ready", service.generator.info, service.knowledge.fingerprint, sentences=(ReplySentence("Thank you for your message.", opening),))
    assert service.validator.validate(ok, analysis, ReplyContext(10, 10)) == []
    assert {f["check"] for f in service.validator.validate(ok, analysis, ReplyContext(10, 11))} == {"stale_context"}


def test_stale_sequence_yields_a_validation_failure_not_a_draft(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "Any update on this?"), context=ReplyContext(10, 11))
    assert d.status == "validation_failed" and d.body == "" and d.sentences == ()
    assert any(f["check"] == "stale_context" for f in d.failures)
    fresh, _ = draft(pipeline, service, ("customer", "Any update on this?"), context=ReplyContext(10, 10))
    assert fresh.status == "ready"


def test_internal_note_wording_is_detected_if_it_ever_leaks(pipeline, service):
    analysis = pipeline.run(conv(("customer", "There is a problem with my document."), ("internal_note", "the customer was rude about the delay yesterday")))
    leak = Source("pattern", "opening")
    checks = {f["check"] for f in unsafe(service, analysis, "Thank you for the customer was rude about the delay.", leak)}
    assert "internal_content" in checks


def test_a_validator_crash_fails_closed(pipeline, pack, knowledge):
    svc = build_reply_service(pack, knowledge, pipeline.components)
    svc.validator.validate = lambda *a, **k: 1 / 0
    d, _ = draft(pipeline, svc, ("customer", "Any update on this?"))
    assert d.status == "validation_failed" and d.body == ""


# --- knowledge --------------------------------------------------------------------------------------------------------------------------------
def test_reply_knowledge_is_a_separate_draft_artifact_and_the_pack_is_unchanged(pack, knowledge):
    assert pack.fingerprint == "verification-support@0.1.0+5d4e92e70ad1"
    assert pack.needs_review == 12
    assert knowledge.status == "draft" and knowledge.fingerprint.startswith("verification-support-replies@0.1.0+")
    assert knowledge.summary()["needsReview"] == knowledge.summary()["patterns"]


def test_unsafe_or_inconsistent_reply_knowledge_cannot_be_loaded(pack, tmp_path):
    def broken(change):
        target = tmp_path / "replies.json"
        data = json.loads(REPLY_FILE.read_text(encoding="utf-8"))
        change(data)
        target.write_text(json.dumps(data), encoding="utf-8")
        with pytest.raises(KnowledgeError) as exc:
            load_reply_knowledge(target, pack)
        return " ".join(exc.value.problems)

    assert "forbidden phrase" in broken(lambda d: d["patterns"][0].update(template="We will look at this soon."))
    assert "digit" in broken(lambda d: d["patterns"][0].update(template="Reply within 3 days."))
    assert "unknown slot" in broken(lambda d: d["patterns"][0].update(template="Hello {name}."))
    assert "unknown intent" in broken(lambda d: d["intents"].update(made_up=d["intents"]["status_request"]))
    assert "unknown entity" in broken(lambda d: next(p for p in d["patterns"] if p["id"] == "ask.which_document").update(entities=["nothing"]))
    assert "written for pack" in broken(lambda d: d.update(packId="another"))
    assert "not approved" in broken(lambda d: d.update(status="approved"))


def test_missing_reply_knowledge_keeps_the_service_not_ready(tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app
    from tests.conftest import make_settings

    client = TestClient(create_app(make_settings(reply_patterns_file=tmp_path / "missing.json")))
    assert client.get("/ready").status_code == 503


# --- independence -----------------------------------------------------------------------------------------------------------------------------
def test_reply_generation_makes_no_network_calls(pipeline, service, monkeypatch):
    def blocked(*a, **k):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket, "socket", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)
    assert draft(pipeline, service, ("customer", "Any update on this?"))[0].status == "ready"


def test_no_mongo_redis_or_llm_dependency_was_introduced():
    import app.main  # noqa: F401

    assert not [m for m in ("pymongo", "motor", "redis", "openai", "anthropic", "requests", "aiohttp") if m in sys.modules]
    assert not [m for m in ("pymongo", "redis", "openai", "anthropic") if m in (KNOWLEDGE_ROOT.parent.parent / "requirements.txt").read_text().lower()]


# --- entity specificity and isolated eligibility (Phase 3C review) --------------------------------------------------------------------
def asks_which_document(d):
    return any("which document" in t and "or verification" not in t for t in texts(d))


@pytest.mark.parametrize("text", [
    "I submitted my passport three times and it was rejected. There is a document issue.",
    "My marksheet was rejected. There is a document issue.",
])
def test_a_specific_entity_suppresses_the_generic_which_document_question(pipeline, service, text):
    d, analysis = draft(pipeline, service, ("customer", text))
    assert {"document"} <= {m.id for m in analysis.mentions if m.kind == "entity"}  # the generic entity is still extracted
    assert d.status == "ready" and not asks_which_document(d)
    assert not any("asked about your document" in t for t in texts(d))
    assert any(s.source.type == "claim" for s in d.sentences)


def test_generic_document_alone_still_gets_the_clarifying_question(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "There is a problem with my document."))
    assert d.status == "ready" and asks_which_document(d)
    assert not any(s.source.type == "claim" for s in d.sentences)


def test_multiple_specific_entities_produce_no_redundant_generic_question(pipeline, service):
    d, _ = draft(pipeline, service, ("customer", "I sent the passport and the certificate, both rejected. Any issue with the document?"))
    assert d.status == "ready" and not asks_which_document(d)
    assert sum(1 for s in d.sentences if s.source.type == "claim") >= 1


def test_the_generic_entity_still_exists_in_the_pack(pack):
    assert "document" in {e.id for e in pack.entities.entities}


def test_eligibility_is_a_separate_knowledge_driven_decision(pipeline, pack, knowledge):
    from app.engine.reply_eligibility import ReplyEligibility

    analysis = pipeline.run(conv(("customer", "Any update on this?")))
    assert analysis.state.state == "awaiting_support"
    assert ReplyEligibility(knowledge).check(analysis, True).eligible
    closed = pipeline.run(conv(("customer", "Any update on this?"), status="resolved", resolved=True))
    gate = ReplyEligibility(knowledge).check(closed, True)
    assert (gate.eligible, gate.reason, gate.detail) == (False, "ambiguous_state", "resolved")
    assert not ReplyEligibility(knowledge).check(analysis, False).eligible
    # the allowed states are data, not generator code: widening them is a knowledge change, and none was made here
    assert knowledge.file.allowedStates == ["awaiting_support"]
    import inspect

    from app.engine import reply

    assert "allowedStates" not in inspect.getsource(reply.RulesReplyGenerator)
