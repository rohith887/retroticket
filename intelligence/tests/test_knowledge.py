import json
import shutil

import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULT_PACK, KNOWLEDGE_ROOT
from app.knowledge.loader import KnowledgeError, load_pack
from app.main import create_app
from tests.conftest import TOKEN, make_settings

PACK = KNOWLEDGE_ROOT / DEFAULT_PACK


@pytest.fixture()
def pack_copy(tmp_path):
    target = tmp_path / "pack"
    shutil.copytree(PACK, target)
    return target


def edit(directory, name, change):
    path = directory / name
    data = json.loads(path.read_text(encoding="utf-8"))
    change(data)
    path.write_text(json.dumps(data), encoding="utf-8")


def test_shipped_pack_is_a_valid_draft_with_flagged_entries():
    pack = load_pack(PACK)
    assert pack.status == "draft"
    assert pack.needs_review > 0  # uncertain vocabulary is flagged, not silently trusted
    assert pack.fingerprint.startswith("verification-support@0.1.0+")


def test_loading_is_deterministic():
    assert load_pack(PACK).fingerprint == load_pack(PACK).fingerprint


def test_content_change_changes_the_fingerprint(pack_copy):
    before = load_pack(pack_copy).fingerprint
    edit(pack_copy, "entities.json", lambda d: d["entities"][0]["synonyms"].append("papers"))
    assert load_pack(pack_copy).fingerprint != before


def test_unknown_fields_are_rejected(pack_copy):
    edit(pack_copy, "actions.json", lambda d: d["actions"][0].update(surprise=1))
    with pytest.raises(KnowledgeError):
        load_pack(pack_copy)


def test_duplicate_ids_and_unknown_references_are_reported_together(pack_copy):
    def change(d):
        d["entities"].append(dict(d["entities"][0]))
        d["entities"][1]["type"] = "nonexistent"
    edit(pack_copy, "entities.json", change)
    with pytest.raises(KnowledgeError) as exc:
        load_pack(pack_copy)
    text = " ".join(exc.value.problems)
    assert "duplicate id" in text and "unknown type" in text


def test_missing_required_group_and_bad_state_rule(pack_copy):
    edit(pack_copy, "indicators.json", lambda d: d.update(groups=[g for g in d["groups"] if g["id"] != "message.closing"]))
    edit(pack_copy, "states.json", lambda d: d["rules"][0].update(then="exploded"))
    with pytest.raises(KnowledgeError) as exc:
        load_pack(pack_copy)
    text = " ".join(exc.value.problems)
    assert "message.closing" in text and "unknown state" in text


def test_missing_file_is_reported(pack_copy):
    (pack_copy / "outcomes.json").unlink()
    with pytest.raises(KnowledgeError):
        load_pack(pack_copy)


def test_a_pack_cannot_be_approved_while_entries_need_review(pack_copy):
    edit(pack_copy, "pack.json", lambda d: d.update(status="approved"))
    with pytest.raises(KnowledgeError) as exc:
        load_pack(pack_copy)
    assert "not approved" in " ".join(exc.value.problems)


def test_require_approved_refuses_a_draft():
    with pytest.raises(KnowledgeError):
        load_pack(PACK, require_approved=True)


def test_invalid_pack_keeps_the_service_not_ready(pack_copy):
    edit(pack_copy, "outcomes.json", lambda d: d.update(outcomes="broken"))
    client = TestClient(create_app(make_settings(knowledge_root=pack_copy.parent, knowledge_pack="pack")))
    assert client.get("/health").status_code == 200
    ready = client.get("/ready")
    assert ready.status_code == 503 and "outcomes.json" in ready.json()["problems"][0]
    denied = client.post("/api/v1/sentiment", json={"text": "hello"}, headers={"Authorization": f"Bearer {TOKEN}"})
    assert denied.status_code == 503


def test_ready_reports_knowledge_and_components(client):
    body = client.get("/ready").json()
    assert body["engine"]["knowledge"]["status"] == "draft"
    assert {c["name"] for c in body["engine"]["components"]} >= {"rules-sentiment", "rules-facts", "rules-state"}
