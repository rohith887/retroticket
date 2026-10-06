from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import TOKEN, make_settings


def test_health_is_open_and_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_reports_provider_and_intents(client):
    body = client.get("/ready").json()
    assert body["status"] == "ready"
    assert body["provider"] == "local_rules"
    assert body["intents"] >= 2


def test_not_ready_without_token_but_health_stays_up_and_endpoints_refuse():
    app = create_app(make_settings(service_token="", problems=("INTERNAL_SERVICE_TOKEN is not set",)))
    c = TestClient(app)
    assert c.get("/health").status_code == 200
    ready = c.get("/ready")
    assert ready.status_code == 503 and "INTERNAL_SERVICE_TOKEN" in ready.json()["problems"][0]
    denied = c.post("/api/v1/sentiment", json={"text": "hello"}, headers={"Authorization": "Bearer anything-at-all-123456"})
    assert denied.status_code == 503 and denied.json()["error"]["code"] == "service_not_configured"


def test_unknown_provider_is_not_ready():
    c = TestClient(create_app(make_settings(provider="does-not-exist")))
    assert c.get("/ready").status_code == 503
    assert c.post("/api/v1/sentiment", json={"text": "hi"}, headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 503


def test_invalid_intents_file_is_not_ready(tmp_path):
    bad = tmp_path / "intents.json"
    bad.write_text('{"intents": [{"label": "a1", "keywords": []}]}')  # no fallback intent
    c = TestClient(create_app(make_settings(intents_file=bad)))
    assert c.get("/ready").status_code == 503
