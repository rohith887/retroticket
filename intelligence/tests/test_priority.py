def priority(analyze, text):
    return analyze(text, "/api/v1/priority")["priority"]


def test_urgent_language_is_high_or_critical(analyze):
    result = priority(analyze, "URGENT: system down and I cannot access the portal, my deadline is tomorrow.")
    assert result["label"] in ("high", "critical") and any("Urgent" in r for r in result["reasons"])


def test_repeated_failure_language_is_high_with_reasons(analyze):
    result = priority(analyze, "I have already submitted this document three times and nobody has fixed the problem.")
    assert result["label"] == "high"
    assert any("Repeated" in r for r in result["reasons"])
    assert 0.5 <= result["confidence"] <= 0.9


def test_normal_request_is_low_and_says_why(analyze):
    result = priority(analyze, "Please share the verification report format.")
    assert result == {"label": "low", "confidence": 0.4, "reasons": ["No urgency or issue signals detected"]}


def test_a_lone_issue_word_is_only_medium_at_most(analyze):
    assert priority(analyze, "I see an error on the page.")["label"] in ("low", "medium")


def test_legal_threat_raises_priority(analyze):
    assert priority(analyze, "This is unacceptable, I will take legal action and contact my lawyer.")["label"] in ("high", "critical")


def test_repeating_a_word_does_not_inflate_the_score(analyze):
    assert priority(analyze, "urgent")["label"] == priority(analyze, "urgent urgent urgent urgent urgent urgent")["label"]


def test_deterministic(analyze):
    text = "Nobody has responded, still not fixed, deadline is tomorrow!"
    results = [priority(analyze, text) for _ in range(5)]
    assert all(r == results[0] for r in results)


def test_service_exposes_no_ticket_write_endpoints(client):
    routes = [r for r in client.app.routes if hasattr(r, "methods")]
    assert not any("ticket" in r.path.lower() for r in routes)
    assert all(r.methods <= {"GET", "POST", "HEAD", "OPTIONS"} for r in routes)
