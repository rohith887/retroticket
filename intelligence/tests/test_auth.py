import pytest

from tests.conftest import TOKEN

ENDPOINTS = ["/api/v1/analyze-message", "/api/v1/sentiment", "/api/v1/intent", "/api/v1/priority"]


@pytest.mark.parametrize("path", ENDPOINTS)
def test_valid_token_is_accepted(client, auth, path):
    assert client.post(path, json={"text": "Please share an update."}, headers=auth).status_code == 200


@pytest.mark.parametrize("path", ENDPOINTS)
def test_missing_token_is_401(client, path):
    response = client.post(path, json={"text": "hello"})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json()["error"]["code"] == "unauthorized"


@pytest.mark.parametrize("header", ["Bearer wrong-token-value-0123456", f"Basic {TOKEN}", "Bearer", TOKEN])
def test_wrong_or_malformed_credentials_are_rejected(client, header):
    response = client.post("/api/v1/sentiment", json={"text": "hello"}, headers={"Authorization": header})
    assert response.status_code in (401, 403)


def test_invalid_token_is_403_and_never_echoed(client):
    response = client.post("/api/v1/sentiment", json={"text": "hello"}, headers={"Authorization": "Bearer wrong-token-value-0123456"})
    assert response.status_code == 403
    assert "wrong-token-value" not in response.text and TOKEN not in response.text


def test_intents_endpoint_also_requires_auth(client, auth):
    assert client.get("/api/v1/intents").status_code == 401
    assert client.get("/api/v1/intents", headers=auth).status_code == 200


def test_request_id_is_returned_and_safe_ids_are_kept(client, auth):
    response = client.post("/api/v1/sentiment", json={"text": "hello"}, headers={**auth, "X-Request-ID": "req-abc-12345"})
    assert response.headers["x-request-id"] == "req-abc-12345" and response.json()["meta"]["requestId"] == "req-abc-12345"
    unsafe = client.post("/api/v1/sentiment", json={"text": "hello"}, headers={**auth, "X-Request-ID": "bad id with spaces!"})
    assert unsafe.headers["x-request-id"] != "bad id with spaces!"
