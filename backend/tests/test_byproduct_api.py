"""ByProduct Analyser backend API regression tests (public URL)."""
import json
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
BANNED = ["pathogen-free", "pathogen free", "cleared for food use", "is safe", "are safe"]


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def created(s):
    # Samples: create via simulated scan spectrum
    scan = s.post(f"{API}/simulate-scan", json={"byproduct": "guar_meal"}).json()
    code = f"TEST-{uuid.uuid4().hex[:4]}"
    r = s.post(f"{API}/samples", json={"sample_code": code, "byproduct": "guar_meal", "supplier": "TEST_sup",
                                         "batch": "TEST_B1", "sample_date": "2026-01-10",
                                         "spectrum": scan["spectrum"], "wavelengths": scan["wavelengths"],
                                         "spectrum_source": "Simulated NIR scan"})
    assert r.status_code == 200, r.text
    return r.json()


# Health / catalog
def test_root(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200 and r.json()["demo_data"] is True


def test_byproducts(s):
    keys = {b["key"] for b in s.get(f"{API}/byproducts").json()}
    assert {"guar_meal", "groundnut_cake", "almond_cake", "rice_bran", "pulse_residue"} <= keys


def test_docs_public(s):
    r = s.get(f"{BASE_URL}/api/docs")
    assert r.status_code == 200 and "swagger" in r.text.lower(), "FastAPI docs not reachable via public /api prefix"


# Samples
def test_list_samples_seeded(s):
    d = s.get(f"{API}/samples").json()
    assert len(d) >= 20
    assert all("overall_status" in x and "score" in x for x in d)


def test_create_and_get_sample(s, created):
    assert created["supplier"] == "TEST_sup" and created["has_spectrum"] is True
    r = s.get(f"{API}/samples/{created['id']}")
    assert r.status_code == 200
    assert r.json()["sample"]["sample_code"] == created["sample_code"]


def test_create_duplicate_409(s, created):
    r = s.post(f"{API}/samples", json={"sample_code": created["sample_code"], "byproduct": "guar_meal",
                                       "supplier": "x", "batch": "y", "sample_date": "2026-01-10"})
    assert r.status_code == 409


def test_create_invalid_byproduct_422(s):
    r = s.post(f"{API}/samples", json={"byproduct": "xyz", "supplier": "x", "batch": "y", "sample_date": "2026-01-10"})
    assert r.status_code == 422


def test_get_sample_404(s):
    assert s.get(f"{API}/samples/doesnotexist").status_code == 404


# Predict
def test_predict(s):
    scan = s.post(f"{API}/simulate-scan", json={"byproduct": "rice_bran"}).json()
    r = s.post(f"{API}/predict", json={"byproduct": "rice_bran", "spectrum": scan["spectrum"], "wavelengths": scan["wavelengths"]})
    assert r.status_code == 200
    targets = {p["target"] for p in r.json()["predictions"]}
    assert "protein" in targets and "phytate" in targets


# Lab results
def test_lab_results_validation(s, created):
    r = s.post(f"{API}/lab-results", json={"sample_id": created["id"], "results": [{"target": "bogus", "value": 1}]})
    assert r.status_code == 422
    r = s.post(f"{API}/lab-results", json={"sample_id": created["id"], "results": [{"target": "water_activity", "value": 1.5}]})
    assert r.status_code == 422 and "Water activity" in r.text
    r = s.post(f"{API}/lab-results", json={"sample_id": created["id"], "results": [{"target": "afb1", "value": -1}]})
    assert r.status_code == 422


def test_lab_results_save_and_report(s, created):
    r = s.post(f"{API}/lab-results", json={"sample_id": created["id"], "results": [
        {"target": "afb1", "value": 25, "method": "HPLC"},
        {"target": "salmonella", "result": "not_detected", "method": "ISO 6579"}]})
    assert r.status_code == 200 and r.json()["saved"] == 2
    rep = s.get(f"{API}/report/{created['id']}").json()
    assert rep["overall_status"] == "FAIL"  # afb1 25 > limit 10
    txt = json.dumps(rep).lower()
    assert "not detected by this test" in txt
    for b in ["pathogen-free", "cleared for food use"]:
        assert b not in txt


def test_report_pdf(s, created):
    r = s.get(f"{API}/report/{created['id']}/pdf")
    assert r.status_code == 200 and r.content[:4] == b"%PDF"


def test_review(s, created):
    r = s.post(f"{API}/samples/{created['id']}/review", json={"note": "TEST"})
    assert r.status_code == 200
    assert s.get(f"{API}/samples/{created['id']}").json()["sample"]["review_status"] == "pending_human_review"


# Dashboard / compare / thresholds
def test_dashboard(s):
    d = s.get(f"{API}/dashboard").json()
    assert d["samples_analysed"] >= 20 and len(d["recent"]) <= 6


def test_compare(s):
    d = s.get(f"{API}/compare").json()["ranking"]
    assert len(d) == 5 and d[0]["avg_score"] >= d[-1]["avg_score"]


def test_thresholds_update_and_reset(s):
    r = s.put(f"{API}/thresholds", json={"thresholds": {"afb1": {"limit": -5}}})
    assert r.status_code == 422
    r = s.put(f"{API}/thresholds", json={"thresholds": {"afb1": {"limit": 12}}})
    assert r.status_code == 200 and r.json()["thresholds"]["afb1"]["limit"] == 12
    assert s.get(f"{API}/thresholds").json()["thresholds"]["afb1"]["limit"] == 12
    s.put(f"{API}/thresholds", json={"thresholds": {"afb1": {"limit": 10}}})


# Model
def test_model_metrics(s):
    r = s.get(f"{API}/model/metrics")
    assert r.status_code == 200 and r.json()


def test_train_template_and_upload_evaluate(s):
    t = s.get(f"{API}/train/template")
    assert t.status_code == 200 and "byproduct" in t.text.splitlines()[0]
    r = s.post(f"{API}/train/upload", files={"file": ("t.csv", t.content, "text/csv")}, data={"mode": "evaluate"})
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "evaluate" and len(r.json()["results"]) > 0


def test_upload_bad_csv(s):
    r = s.post(f"{API}/train/upload", files={"file": ("t.csv", b"a,b\n1,2\n", "text/csv")}, data={"mode": "evaluate"})
    assert r.status_code == 422


# Agent (SSE)
def _sse(resp):
    evs = []
    for line in resp.iter_lines(decode_unicode=True):
        if line and line.startswith("data: "):
            evs.append(json.loads(line[6:]))
    return evs


def test_agent_run_full(s, created):
    with s.post(f"{API}/agent/run", json={"sample_id": created["id"], "provider": "claude"}, stream=True, timeout=180) as r:
        evs = _sse(r)
    steps = [e["tool"] for e in evs if e["type"] == "step"]
    assert steps == ["get_sample", "run_prediction", "check_safety_rules", "find_missing_data", "suggest_retests", "generate_report"]
    final = [e for e in evs if e["type"] == "final"][0]
    notices = [e for e in evs if e["type"] == "notice"]
    print("CLAUDE llm:", final["llm"], final["provider"], notices)
    assert final["llm"] is True, f"LLM not used (fallback). notices={notices}"
    low = final["text"].lower()
    for b in BANNED:
        assert b not in low
    assert evs[-1]["type"] == "done" and evs[-1]["human_review_required"] is True


def test_agent_chat_chatgpt(s):
    with s.post(f"{API}/agent/chat", json={"message": "Which by-product is best for protein flour?",
                                           "session_id": "TEST_" + uuid.uuid4().hex, "provider": "chatgpt"},
                stream=True, timeout=180) as r:
        evs = _sse(r)
    plan = [e for e in evs if e["type"] == "plan"][0]
    assert any(st["tool"] == "compare_byproducts" for st in plan["steps"])
    final = [e for e in evs if e["type"] == "final"][0]
    notices = [e for e in evs if e["type"] == "notice"]
    print("CHATGPT llm:", final["llm"], final["provider"], notices)
    assert final["llm"] is True, f"LLM not used (fallback). notices={notices}"


def test_agent_logs(s):
    d = s.get(f"{API}/agent/logs?limit=10").json()
    assert len(d) > 0 and "kind" in d[0]
