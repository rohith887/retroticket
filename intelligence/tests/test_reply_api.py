import json

BODY = {
    "ticketId": "t1",
    "locale": "en",
    "ticket": {"status": "open", "priority": "medium"},
    "messages": [{"id": "m1", "role": "customer", "text": "I submitted my passport three times and it was rejected. There is a document issue. Mail jane@example.com"}],
    "events": [],
    "sequence": {"basedOn": 5, "current": 5},
}


def post(client, auth, body=BODY):
    return client.post("/api/v1/reply-draft", json=body, headers=auth)


def test_reply_draft_returns_a_sourced_draft_with_versions(client, auth):
    response = post(client, auth)
    assert response.status_code == 200, response.text
    body = response.json()
    draft = body["replyDraft"]
    assert draft["status"] == "ready" and draft["body"]
    assert any(s["source"]["type"] == "claim" and s["source"]["factIds"] for s in draft["sentences"])
    assert body["replyKnowledge"]["status"] == "draft"
    assert body["knowledge"]["id"] == "verification-support" and body["meta"]["knowledge"].startswith("verification-support@0.1.0+5d4e92e70ad1")
    assert "rules-reply" in [c["name"] for c in body["components"]]
    assert body["featureSnapshot"]["reply"]["status"] == "ready"


def test_reply_draft_never_echoes_raw_text(client, auth):
    dumped = json.dumps(post(client, auth).json())
    for raw in ("jane@example.com", "submitted my passport", "Mail "):
        assert raw not in dumped


def test_internal_notes_are_refused_outright(client, auth):
    body = {**BODY, "messages": BODY["messages"] + [{"id": "m2", "role": "internal_note", "text": "escalate"}]}
    response = post(client, auth, body)
    assert response.status_code == 422 and response.json()["error"]["code"] == "internal_notes_not_allowed"


def test_stale_sequence_is_reported_as_a_validation_failure(client, auth):
    body = {**BODY, "sequence": {"basedOn": 5, "current": 6}}
    draft = post(client, auth, body).json()["replyDraft"]
    assert draft["status"] == "validation_failed" and draft["body"] == "" and draft["sentences"] == []
    assert draft["failures"][0]["check"] == "stale_context"


def test_insufficient_context_is_structured(client, auth):
    body = {**BODY, "messages": [{"id": "m1", "role": "customer", "text": "The website is not working, error on login."}]}
    draft = post(client, auth, body).json()["replyDraft"]
    assert draft["status"] == "insufficient_context" and draft["reason"] == "unsupported_request" and draft["body"] == ""


def test_requires_authentication_and_strict_body(client, auth):
    assert client.post("/api/v1/reply-draft", json=BODY).status_code == 401
    assert post(client, auth, {**BODY, "extra": 1}).status_code == 422
    assert post(client, auth, {**BODY, "sequence": {"basedOn": -1, "current": 0}}).status_code == 422


def test_ready_reports_reply_knowledge(client):
    assert client.get("/ready").json()["engine"]["replyKnowledge"]["patterns"] >= 5
