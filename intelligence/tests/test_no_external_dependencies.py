"""Phase 1 guarantees: the provider is local. No database driver, no Redis, no AI SDK, no network."""
import socket
import sys
from pathlib import Path

FORBIDDEN = ("pymongo", "motor", "redis", "bullmq", "openai", "anthropic", "requests", "aiohttp", "textblob", "socketio")
ROOT = Path(__file__).resolve().parent.parent


def test_the_application_imports_no_database_redis_ai_or_http_client_libraries():
    import app.main  # noqa: F401 - importing wires the whole application

    loaded = sorted(name for name in FORBIDDEN if name in sys.modules)
    assert loaded == [], f"unexpected libraries loaded: {loaded}"


def test_requirements_list_no_forbidden_runtime_dependencies():
    runtime = (ROOT / "requirements.txt").read_text().lower()
    for name in FORBIDDEN + ("httpx", "pytest"):
        assert name not in runtime, f"{name} must not be a runtime dependency"


def test_source_never_references_mongo_redis_or_outbound_http():
    for path in (ROOT / "app").rglob("*.py"):
        source = path.read_text(encoding="utf-8").lower()
        for needle in ("mongodb://", "pymongo", "redis://", "requests.post", "urllib.request", "import httpx"):
            assert needle not in source, f"{path.name} references {needle}"


def test_provider_performs_no_network_or_socket_operations(monkeypatch):
    # Called directly: the in-process HTTP test client itself opens a loopback socket pair on Windows, the provider must not.
    from app.config import DEFAULT_PACK, KNOWLEDGE_ROOT
    from app.knowledge.loader import load_pack
    from app.providers.local_rules import LocalRulesProvider

    provider = LocalRulesProvider(load_pack(KNOWLEDGE_ROOT / DEFAULT_PACK))

    def blocked(*args, **kwargs):
        raise AssertionError("network access attempted during analysis")

    monkeypatch.setattr(socket, "socket", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)
    result = provider.analyze_message("I have already submitted this document three times and nobody has fixed the problem.")
    assert result.priority.label == "high"


def test_provider_methods_run_without_any_app_or_io():
    from app.config import DEFAULT_PACK, KNOWLEDGE_ROOT
    from app.knowledge.loader import load_pack
    from app.providers.local_rules import LocalRulesProvider

    provider = LocalRulesProvider(load_pack(KNOWLEDGE_ROOT / DEFAULT_PACK))
    assert provider.analyze_message("Thank you, that works now.").sentiment.label == "positive"
