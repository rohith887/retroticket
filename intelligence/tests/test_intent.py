import json

from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import TOKEN, make_settings

CLEAR = "The uploaded certificate was rejected as blurry. I will resubmit a clearer scan of the document."


def intent(analyze, text):
    return analyze(text, "/api/v1/intent")["intent"]


def test_known_intent(analyze):
    result = intent(analyze, CLEAR)
    assert result["label"] == "document_issue" and result["confidence"] >= 0.7


def test_status_request(analyze):
    assert intent(analyze, "Any update on the status? When will this be completed?")["label"] == "status_request"


def test_technical_issue(analyze):
    assert intent(analyze, "I cannot login, the OTP never arrives and the portal is not loading.")["label"] == "technical_issue"


def test_multiple_signals_report_alternatives_and_lower_confidence(analyze):
    mixed = intent(analyze, "Any update on the status? Also the document I uploaded was rejected.")
    assert mixed["alternatives"], "a message with several intents should list the runner-ups"
    assert mixed["confidence"] <= intent(analyze, CLEAR)["confidence"]


def test_fallback_to_other_with_low_confidence(analyze):
    assert intent(analyze, "zzz qqq xyzzy") == {"label": "other", "confidence": 0.3, "alternatives": []}


def test_single_weak_signal_is_capped_at_medium_confidence(analyze):
    assert intent(analyze, "Could you send me the verification report?")["confidence"] <= 0.5


def test_deterministic(analyze):
    text = "Correction needed: wrong date on my certificate."
    assert len({json.dumps(intent(analyze, text), sort_keys=True) for _ in range(5)}) == 1


def test_categories_are_configurable_without_code_changes(tmp_path):
    custom = tmp_path / "intents.json"
    custom.write_text(json.dumps({"intents": [
        {"label": "billing", "keywords": [{"phrase": "invoice*", "weight": 3}, {"phrase": "payment", "weight": 2}]},
        {"label": "fallback_topic", "fallback": True},
    ]}))
    c = TestClient(create_app(make_settings(intents_file=custom)))
    headers = {"Authorization": f"Bearer {TOKEN}"}
    assert c.post("/api/v1/intent", json={"text": "Where is my invoice for the payment?"}, headers=headers).json()["intent"]["label"] == "billing"
    assert c.post("/api/v1/intent", json={"text": "hello there"}, headers=headers).json()["intent"]["label"] == "fallback_topic"
    assert [i["label"] for i in c.get("/api/v1/intents", headers=headers).json()["intents"]] == ["billing", "fallback_topic"]
