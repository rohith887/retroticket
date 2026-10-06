import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

TOKEN = "unit-test-service-token-0123456789"


def make_settings(**overrides) -> Settings:
    base = dict(service_token=TOKEN, rate_limit_per_minute=0, max_body_bytes=4096, max_text_chars=1000)
    base.update(overrides)
    return Settings(**base)


@pytest.fixture()
def settings():
    return make_settings()


@pytest.fixture()
def client(settings):
    return TestClient(create_app(settings))


@pytest.fixture()
def auth():
    return {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture()
def analyze(client, auth):
    def _call(text, path="/api/v1/analyze-message"):
        response = client.post(path, json={"text": text}, headers=auth)
        assert response.status_code == 200, response.text
        return response.json()

    return _call
