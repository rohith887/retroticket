import pytest


def post(client, auth, payload, path="/api/v1/analyze-message"):
    return client.post(path, json=payload, headers=auth)


def test_missing_text_is_422(client, auth):
    response = post(client, auth, {"ticketId": "t1"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("text", ["", "   ", "\n\t"])
def test_empty_text_is_422(client, auth, text):
    assert post(client, auth, {"text": text}).status_code == 422


def test_unknown_fields_are_rejected(client, auth):
    response = post(client, auth, {"text": "hello", "priority": "critical"})
    assert response.status_code == 422
    assert "priority" in response.text  # names the field, not its value


def test_wrong_types_are_422(client, auth):
    assert post(client, auth, {"text": 123}).status_code == 422
    assert post(client, auth, {"text": "hi", "ticketId": {"a": 1}}).status_code == 422


def test_malformed_json_is_422_without_echoing_the_body(client, auth):
    response = client.post("/api/v1/sentiment", content=b'{"text": "secret customer words', headers={**auth, "Content-Type": "application/json"})
    assert response.status_code == 422
    assert "secret customer words" not in response.text


def test_validation_errors_do_not_echo_the_customer_text(client, auth):
    response = post(client, auth, {"text": "my password is hunter2", "extra": 1})
    assert response.status_code == 422 and "hunter2" not in response.text


def test_text_over_the_configured_limit_is_413(client, auth):
    response = post(client, auth, {"text": "a" * 1500})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_body_over_the_byte_limit_is_413_before_parsing(client, auth):
    response = post(client, auth, {"text": "a" * 5000})
    assert response.status_code == 413


def test_wrong_method_and_unknown_path_use_the_error_envelope(client, auth):
    assert client.get("/api/v1/sentiment", headers=auth).status_code == 405
    missing = client.get("/api/v1/nope", headers=auth)
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "not_found"
