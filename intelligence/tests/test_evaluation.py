import json

import pytest

from app.config import DEFAULT_PACK, KNOWLEDGE_ROOT
from app.engine.pipeline import Pipeline
from app.evaluation.dataset import load_cases
from app.evaluation.metrics import Exact, SetMatch
from app.evaluation.runner import evaluate, run
from app.knowledge.loader import load_pack


def test_golden_set_is_well_formed_and_marks_ambiguous_cases_unsuitable():
    cases = load_cases()
    assert len({c.id for c in cases}) == len(cases)
    assert any(not c.suitable and c.unsuitable_reason for c in cases)
    assert all(c.curation == "proposed" for c in cases)  # nothing has been reviewed by a domain expert yet


def test_report_has_counts_and_an_explicit_caveat_but_no_accuracy_figure():
    report = run()
    assert "no reviewed cases" in report["caveat"].lower() or "No reviewed cases" in report["caveat"]
    assert "accuracy" not in {k.lower() for k in report}
    assert report["byCuration"]["proposed"]["cases"] > 0
    assert report["skippedUnsuitable"]


def test_expected_values_are_not_part_of_the_knowledge_pack():
    text = " ".join(p.read_text(encoding="utf-8") for p in (KNOWLEDGE_ROOT / DEFAULT_PACK).glob("*.json"))
    assert "syn-passport-rejected" not in text and "golden" not in text.lower().replace("golden set", "")


def test_metrics_counts():
    e = Exact()
    e.add("a", "a")
    e.add("a", "b")
    assert e.to_dict() == {"correct": 1, "evaluated": 2}
    s = SetMatch()
    s.add({"x", "y"}, {"x", "z"})
    d = s.to_dict()
    assert (d["tp"], d["fp"], d["fn"], d["precision"], d["recall"]) == (1, 1, 1, 0.5, 0.5)
    assert SetMatch().to_dict()["f1"] is None


def test_a_wrong_expectation_is_reported_as_a_mismatch(tmp_path):
    path = tmp_path / "cases.json"
    path.write_text(json.dumps({"cases": [{"id": "x", "source": "synthetic", "curation": "proposed", "suitable": True,
        "conversation": {"ticket": {"status": "open"}, "messages": [{"id": "m1", "role": "customer", "text": "Any update on this?"}]},
        "expected": {"intent": "complaint"}}]}))
    report = evaluate(Pipeline.build(load_pack(KNOWLEDGE_ROOT / DEFAULT_PACK)), load_cases(path))
    assert report["mismatches"][0]["dimension"] == "intent"
    assert report["byCuration"]["proposed"]["intent"] == {"correct": 0, "evaluated": 1}


def test_unsuitable_case_without_reason_is_rejected(tmp_path):
    path = tmp_path / "cases.json"
    path.write_text(json.dumps({"cases": [{"id": "x", "source": "synthetic", "curation": "proposed", "suitable": False,
        "conversation": {"ticket": {"status": "open"}, "messages": [{"id": "m1", "role": "customer", "text": "ok"}]}}]}))
    with pytest.raises(ValueError):
        load_cases(path)
