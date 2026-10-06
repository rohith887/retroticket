import json

BODY = {
    "ticketId": "t1",
    "locale": "en",
    "ticket": {"status": "open", "priority": "medium"},
    "messages": [
        {"id": "m1", "role": "customer", "text": "I submitted my passport three times and it was rejected. Contact jane@example.com"},
        {"id": "m2", "role": "agent", "text": "Please upload a clearer copy."},
    ],
    "events": [{"id": "e1", "type": "assigned", "data": {"to": "agent-1"}}],
}


def post(client, auth, body=BODY):
    return client.post("/api/v1/analyze-conversation", json=body, headers=auth)


def test_analyze_conversation_returns_facts_state_and_versions(client, auth):
    response = post(client, auth)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["state"]["state"] == "awaiting_customer" and body["state"]["ruleId"] == "R5"
    assert body["knowledge"]["status"] == "draft" and body["engineVersion"]
    assert any(f["kind"] == "claim" and f["entity"] == "passport" and f["outcome"] == "rejected" for f in body["facts"])
    assert any(f["kind"] == "verified" for f in body["facts"])
    assert body["featureSnapshot"]["components"]["rules-state"]


def test_response_never_echoes_customer_text_or_contact_data(client, auth):
    dumped = json.dumps(post(client, auth).json())
    for raw in ("jane@example.com", "submitted my passport", "clearer copy"):
        assert raw not in dumped


def test_requires_authentication_and_rejects_unknown_fields(client, auth):
    assert client.post("/api/v1/analyze-conversation", json=BODY).status_code == 401
    assert post(client, auth, {**BODY, "extra": 1}).status_code == 422
    assert post(client, auth, {**BODY, "messages": []}).status_code == 422
    assert post(client, auth, {**BODY, "locale": "fr"}).status_code == 422


def test_oversized_message_is_refused(client, auth):
    big = {**BODY, "messages": [{"id": "m1", "role": "customer", "text": "x" * 1001}]}
    assert post(client, auth, big).status_code == 413


def test_llm_endpoints_and_config_are_gone(client, auth):
    assert client.post("/api/v1/summarize", json={}, headers=auth).status_code in (404, 405)
    assert "llm" not in client.get("/ready").json()


def test_summary_is_built_from_facts_with_provenance_and_claims_stay_claims(client, auth):
    summary = post(client, auth).json()["summary"]
    texts = [line["text"] for line in summary["lines"]]
    assert "The customer says they submitted the passport three times and it was rejected." in texts
    assert "The ticket status is open." in texts
    claim = next(line for line in summary["lines"] if line["section"] == "claim")
    assert claim["factIds"] and claim["sources"][0]["messageId"] == "m1" and claim["review"] == "needs_review"  # passport is still under review
    assert any("draft knowledge pack" in w for w in summary["warnings"])
    assert any("passport" in w for w in summary["warnings"])  # the review item is surfaced, not resolved silently
    assert summary["knowledge"].startswith("verification-support@0.1.0+")
    assert summary["text"] == " ".join(texts)


def test_summary_never_states_a_claim_as_verified_and_ignores_internal_notes(client, auth):
    body = {**BODY, "messages": BODY["messages"] + [{"id": "m3", "role": "internal_note", "text": "The certificate was rejected twice, escalate."}]}
    summary = post(client, auth, body).json()["summary"]
    assert not any("certificate" in line["text"] for line in summary["lines"])
    for line in summary["lines"]:
        if line["section"] == "claim":
            assert line["text"].startswith("The customer")
        if line["section"] == "verified":
            assert line["text"].startswith("The ticket")


def test_summary_is_deterministic_and_carries_no_raw_text(client, auth):
    a, b = post(client, auth).json()["summary"], post(client, auth).json()["summary"]
    assert a == b
    assert "jane@example.com" not in json.dumps(a)


def test_unknown_state_is_stated_as_unknown(client, auth):
    body = {**BODY, "messages": [{"id": "m1", "role": "agent", "text": "Hello."}]}
    summary = post(client, auth, body).json()["summary"]
    assert summary["lines"][-1]["text"] == "The current state of the conversation could not be determined."
