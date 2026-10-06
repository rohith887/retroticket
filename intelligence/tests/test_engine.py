import json
import socket

import pytest

from app.config import DEFAULT_PACK, KNOWLEDGE_ROOT
from app.engine.model import ConversationInput, InputMessage, SystemEvent, TicketInput
from app.engine.pipeline import Pipeline
from app.engine.realise import Realiser
from app.engine.registry import parse_selection
from app.engine.snapshot import feature_snapshot
from app.knowledge.loader import load_pack
from app.utils.errors import ConfigurationError


@pytest.fixture(scope="module")
def pack():
    return load_pack(KNOWLEDGE_ROOT / DEFAULT_PACK)


@pytest.fixture(scope="module")
def pipeline(pack):
    return Pipeline.build(pack)


def conv(*messages, status="open", resolved=False, events=()):
    return ConversationInput(TicketInput(status, None, resolved), tuple(InputMessage(f"m{i + 1}", role, text) for i, (role, text) in enumerate(messages)), tuple(events))


def claims(analysis):
    return [f for f in analysis.facts if f.kind == "claim" and f.entity]


# --- extraction -------------------------------------------------------------------------------------------------------
def test_passport_example_is_a_claim_with_entity_action_outcome_and_count(pipeline):
    a = pipeline.run(conv(("customer", "I submitted my passport three times and it was rejected.")))
    (fact,) = claims(a)
    assert (fact.entity, fact.action, fact.outcome, fact.count, fact.polarity) == ("passport", "submitted", "rejected", 3, "affirmed")
    assert fact.kind == "claim" and fact.party == "customer"
    assert not any(f.kind == "verified" and f.entity for f in a.facts)  # never promoted to verified


def test_outcome_is_linked_to_the_entity_in_the_previous_sentence_by_pronoun(pipeline):
    a = pipeline.run(conv(("customer", "I uploaded the marksheet yesterday. It was rejected.")))
    outcome_facts = [f for f in claims(a) if f.outcome]
    assert outcome_facts and outcome_facts[0].entity == "marksheet" and outcome_facts[0].linked_by == "pronoun"


def test_negation_sets_polarity(pipeline):
    a = pipeline.run(conv(("customer", "I have not received the certificate.")))
    (fact,) = claims(a)
    assert (fact.entity, fact.action, fact.polarity) == ("certificate", "received", "negated")


def test_questions_do_not_become_claims_but_become_requests(pipeline):
    a = pipeline.run(conv(("customer", "Can you tell me when my passport will be verified?")))
    assert not [f for f in claims(a) if f.action or f.outcome]
    assert any(p.kind == "unanswered_question" for p in a.pending)


def test_agent_and_internal_text_never_becomes_a_customer_claim(pipeline):
    a = pipeline.run(conv(("customer", "Please check my employment verification."), ("agent", "Please upload the passport."), ("internal_note", "Passport was rejected before.")))
    assert all(f.party == "customer" for f in a.facts if f.kind == "claim")


def test_system_generated_mail_is_marked_automated_and_ignored(pipeline):
    a = pipeline.run(conv(("customer", "Your one-time password is 123456. Do not share this OTP."), ("customer", "The passport was rejected.")))
    assert [m.party for m in a.messages] == ["automated", "customer"]
    assert all(f.provenance.message_id != "m1" for f in a.facts if f.kind == "claim")


# --- facts and provenance -----------------------------------------------------------------------------------------------
def test_verified_facts_come_only_from_ticket_data_and_events(pipeline):
    events = [SystemEvent("e1", "status_changed", None, {"from": "open", "to": "resolved", "note": "some free text that must not be copied"})]
    a = pipeline.run(conv(("customer", "The passport was rejected."), status="resolved", resolved=True, events=events))
    verified = [f for f in a.facts if f.kind == "verified"]
    assert {f.field for f in verified} == {"status", "event"}
    assert all("note" not in json.dumps(f.to_dict()) for f in verified)


def test_provenance_and_no_raw_text_in_output(pipeline):
    text = "My passport was rejected. Contact me at jane.doe@example.com or 555-123-4567."
    a = pipeline.run(conv(("customer", text)))
    (fact,) = [f for f in claims(a) if f.outcome]
    prov = fact.to_dict()["provenance"]
    assert prov["messageId"] == "m1" and prov["sentenceIndex"] == 0 and prov["span"][0] < prov["span"][1]
    assert prov["extractedBy"]["name"] == "rules-facts" and prov["knowledge"].startswith("verification-support@")
    dumped = json.dumps([f.to_dict() for f in a.facts]) + json.dumps(feature_snapshot(a))
    for raw in ("jane.doe", "555-123", "My passport was rejected"):
        assert raw not in dumped


def test_unrecognised_sentences_are_counted_not_guessed(pipeline):
    a = pipeline.run(conv(("customer", "The weather was lovely yesterday.")))
    assert a.unrecognised_sentences == 1 and not claims(a)


# --- state machine ----------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    "messages,resolved,state,rule",
    [
        ([("customer", "Any update on this?")], False, "awaiting_support", "R3"),
        ([("customer", "Any update on this?")], True, "resolved", "R1"),
        ([("customer", "Any update on this?"), ("agent", "Please upload the passport.")], False, "awaiting_customer", "R5"),
        ([("customer", "Thank you for your assistance.")], False, "unknown", "R4"),
        ([("customer", "My passport was rejected."), ("agent", "We are looking into it.")], False, "unresolved", "R6"),
        ([("customer", "My passport was rejected.")], False, "awaiting_support", "R7"),
    ],
)
def test_state_rules(pipeline, messages, resolved, state, rule):
    a = pipeline.run(conv(*messages, status="resolved" if resolved else "open", resolved=resolved))
    assert (a.state.state, a.state.rule_id) == (state, rule)
    assert a.state.justification


def test_state_is_unknown_when_no_rule_applies(pipeline):
    a = pipeline.run(conv(("agent", "Hello.")))
    assert a.state.state == "unknown" and a.state.rule_id is None


# --- realiser -----------------------------------------------------------------------------------------------------------------
def test_realiser_states_customer_statements_as_claims(pipeline, pack):
    a = pipeline.run(conv(("customer", "I submitted my passport three times and it was rejected."), status="open"))
    r = Realiser(pack)
    (fact,) = claims(a)
    assert r.fact(fact) == "The customer says they submitted the passport three times and it was rejected."
    assert r.verified(next(f for f in a.facts if f.field == "status")) == "The ticket status is open."
    assert r.state("unknown").startswith("The current state")


def test_realiser_says_nothing_it_cannot_ground(pipeline, pack):
    a = pipeline.run(conv(("customer", "Any update on this?")))
    r = Realiser(pack)
    assert all(r.fact(f) is None for f in a.facts if f.kind == "claim" and f.entity is None)
    assert r.verified(next(f for f in a.facts if f.kind == "verified")) is not None


# --- determinism, components, offline --------------------------------------------------------------------------------------------
def test_pipeline_is_deterministic(pipeline):
    c = conv(("customer", "I sent the passport twice and nobody replied!!"), ("agent", "We are looking into it."))
    assert pipeline.run(c) == pipeline.run(c)
    assert feature_snapshot(pipeline.run(c)) == feature_snapshot(pipeline.run(c))


def test_component_selection_rejects_unknown_names():
    assert parse_selection("sentiment=rules-sentiment") == {"sentiment": "rules-sentiment"}
    for bad in ("sentiment=gpt", "nonsense=rules-sentiment", "sentiment"):
        with pytest.raises(ConfigurationError):
            parse_selection(bad)


def test_every_component_reports_name_and_version(pipeline):
    assert all(i.name and i.version for i in pipeline.component_infos())


def test_pipeline_makes_no_network_calls(pipeline, monkeypatch):
    def blocked(*a, **k):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket, "socket", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)
    assert pipeline.run(conv(("customer", "The passport was rejected."))).state.state
