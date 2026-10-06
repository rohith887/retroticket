EXAMPLE = "I have already submitted this document three times and nobody has fixed the problem."


def test_combined_analysis_returns_all_three_and_meta(client, auth):
    response = client.post(
        "/api/v1/analyze-message",
        json={"ticketId": "t-1", "conversationId": "c-1", "messageId": "m-1", "text": EXAMPLE},
        headers=auth,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["sentiment"]["label"] == "frustrated"
    assert body["intent"]["label"] == "document_issue"
    assert body["priority"]["label"] == "high" and body["priority"]["reasons"]
    assert set(body["meta"]) == {"provider", "model", "version", "latencyMs", "requestId", "engineVersion", "knowledge", "componentVersions"}
    assert body["meta"]["knowledge"].startswith("verification-support@")
    assert body["meta"]["provider"] == "local_rules"


def test_combined_matches_the_individual_endpoints(client, auth):
    combined = client.post("/api/v1/analyze-message", json={"text": EXAMPLE}, headers=auth).json()
    single = {
        "sentiment": client.post("/api/v1/sentiment", json={"text": EXAMPLE}, headers=auth).json()["sentiment"],
        "intent": client.post("/api/v1/intent", json={"text": EXAMPLE}, headers=auth).json()["intent"],
        "priority": client.post("/api/v1/priority", json={"text": EXAMPLE}, headers=auth).json()["priority"],
    }
    for key in single:
        assert combined[key] == single[key]


def test_confidences_are_in_range_and_rounded(client, auth):
    body = client.post("/api/v1/analyze-message", json={"text": EXAMPLE}, headers=auth).json()
    for key in ("sentiment", "intent", "priority"):
        assert 0 <= body[key]["confidence"] <= 1
        assert round(body[key]["confidence"], 2) == body[key]["confidence"]
