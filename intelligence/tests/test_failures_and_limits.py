import logging

from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.base import AIProvider, ProviderInfo
from tests.conftest import TOKEN, make_settings

HEADERS = {"Authorization": f"Bearer {TOKEN}"}


class ExplodingProvider(AIProvider):
    @property
    def info(self):
        return ProviderInfo("exploding", "none", "0")

    def analyze_sentiment(self, text):
        raise RuntimeError("boom: secret-internal-detail")

    def classify_intent(self, text):
        raise RuntimeError("boom")

    def suggest_priority(self, text):
        raise RuntimeError("boom")


def test_provider_failure_is_a_controlled_502_without_details():
    c = TestClient(create_app(make_settings(), provider=ExplodingProvider()), raise_server_exceptions=False)
    response = c.post("/api/v1/analyze-message", json={"text": "hello"}, headers=HEADERS)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "provider_error"
    assert "secret-internal-detail" not in response.text and "Traceback" not in response.text
    assert c.get("/health").status_code == 200  # the service itself is still up


def test_unexpected_error_is_a_500_without_stack_trace():
    class Broken(ExplodingProvider):
        def analyze_message(self, text):
            return object()  # not a MessageAnalysis: building the response fails after the provider call

    c = TestClient(create_app(make_settings(), provider=Broken()), raise_server_exceptions=False)
    response = c.post("/api/v1/analyze-message", json={"text": "hello"}, headers=HEADERS)
    assert response.status_code == 500 and response.json()["error"]["code"] == "internal_error"
    assert "Traceback" not in response.text


def test_rate_limit_returns_429_with_retry_after():
    c = TestClient(create_app(make_settings(rate_limit_per_minute=3)))
    codes = [c.post("/api/v1/sentiment", json={"text": "hello"}, headers=HEADERS).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    limited = c.post("/api/v1/sentiment", json={"text": "hello"}, headers=HEADERS)
    assert int(limited.headers["retry-after"]) >= 1


def test_rate_limit_does_not_apply_to_health():
    c = TestClient(create_app(make_settings(rate_limit_per_minute=1)))
    assert all(c.get("/health").status_code == 200 for _ in range(5))


def test_unauthenticated_requests_do_not_consume_the_rate_limit():
    c = TestClient(create_app(make_settings(rate_limit_per_minute=2)))
    for _ in range(5):
        assert c.post("/api/v1/sentiment", json={"text": "hi"}).status_code == 401
    assert c.post("/api/v1/sentiment", json={"text": "hi"}, headers=HEADERS).status_code == 200


def test_logs_never_contain_the_message_text(client, auth, caplog):
    log = logging.getLogger("intelligence")
    log.propagate = True
    try:
        with caplog.at_level(logging.INFO, logger="intelligence"):
            client.post("/api/v1/analyze-message", json={"text": "my secret phrase zebra-unicorn-42"}, headers=auth)
    finally:
        log.propagate = False
    assert "zebra-unicorn-42" not in caplog.text
    assert "analyze-message" in caplog.text  # metadata is logged
