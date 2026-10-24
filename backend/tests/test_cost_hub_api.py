"""Add-on 2 (Cost & Fix Hub) API tests: fixes, cost estimate, scenarios, conventional sources CRUD/CSV, comparison, hub+report PDFs."""
import io
import os
import uuid
import pytest
import requests
import fitz  # pymupdf

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
BANNED = ["is safe", "are safe", "safe to eat", "make it safe", "makes it safe", "made safe", "cleared for food use", "pathogen-free"]


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def ids(s):
    return {x["sample_code"]: x["id"] for x in s.get(f"{API}/samples").json()}


def pdf_text(content):
    doc = fitz.open(stream=content, filetype="pdf")
    return "\n".join(p.get_text() for p in doc), doc.page_count


# --- fixes catalogue
def test_fixes_catalogue(s):
    r = s.get(f"{API}/fixes")
    assert r.status_code == 200
    d = r.json()
    assert len(d["fixes"]) > 5 and "aflatoxin" in d["problems"]
    afla = [f for f in d["fixes"] if f["problem"] == "aflatoxin"]
    assert afla and all(f["status"] == "Divert or reject" for f in afla)


# --- cost estimate
def test_estimate_fix_sample(s, ids):
    r = s.post(f"{API}/cost/estimate", json={"sample_id": ids["DEMO-FIX-01"]})
    assert r.status_code == 200
    d = r.json()
    assert d["safety_block"] is False and d["scenario"] == "fixes" and d["fixes_used"]
    for k in ("waterfall", "sankey_mass", "sankey_protein", "tornado", "monte_carlo", "batch_curve", "before_after"):
        assert d[k], k
    assert d["batch_kg"] == 1000


def test_estimate_afla_safety_block(s, ids):
    d = s.post(f"{API}/cost/estimate", json={"sample_id": ids["DEMO-AFLA-01"]}).json()
    assert d["safety_block"] is True and d["scenario"] == "rejected" and d["fixes_used"] == []


def test_estimate_afla_forced_fixes_still_blocked(s, ids):
    d = s.post(f"{API}/cost/estimate", json={"sample_id": ids["DEMO-AFLA-01"], "scenario": "fixes", "fixes": ["fx18"]}).json()
    assert d["safety_block"] is True


def test_estimate_byproduct_and_stack_changes_cost(s, ids):
    r = s.post(f"{API}/cost/estimate", json={"byproduct": "rice_bran"})
    assert r.status_code == 200 and r.json()["profile"]["byproduct"] == "rice_bran"
    a = s.post(f"{API}/cost/estimate", json={"sample_id": ids["DEMO-FIX-01"], "fixes": []}).json()
    b = s.post(f"{API}/cost/estimate", json={"sample_id": ids["DEMO-FIX-01"]}).json()
    assert a["metrics"]["fixes"]["total"] != b["metrics"]["fixes"]["total"]


def test_estimate_overrides_and_validation(s, ids):
    sid = ids["DEMO-FIX-01"]
    a = s.post(f"{API}/cost/estimate", json={"sample_id": sid, "overrides": {"batch_kg": 200}}).json()
    assert a["batch_kg"] == 200
    for bad in ({"batch_kg": 0}, {"yield_pct": 150}, {"failure_prob": 2}, {"raw_price": "abc"}):
        assert s.post(f"{API}/cost/estimate", json={"sample_id": sid, "overrides": bad}).status_code == 422, bad
    assert s.post(f"{API}/cost/estimate", json={"sample_id": "nope"}).status_code == 404


# --- saved scenarios
def test_scenario_save_list_delete(s, ids):
    r = s.post(f"{API}/cost/scenarios", json={"name": "TEST_scn", "sample_id": ids["DEMO-FIX-01"], "overrides": {"batch_kg": 300}})
    assert r.status_code == 200
    sc = r.json()
    assert sc["summary"]["batch_kg"] == 300
    assert any(x["id"] == sc["id"] for x in s.get(f"{API}/cost/scenarios").json())
    s.delete(f"{API}/cost/scenarios/{sc['id']}")
    assert not any(x["id"] == sc["id"] for x in s.get(f"{API}/cost/scenarios").json())


def test_scenario_empty_name_422(s, ids):
    assert s.post(f"{API}/cost/scenarios", json={"name": "", "sample_id": ids["DEMO-FIX-01"]}).status_code == 422


# --- assumptions
def test_assumptions_roundtrip(s):
    cur = s.get(f"{API}/cost/assumptions").json()["assumptions"]
    assert cur["batch_kg"] == 1000
    r = s.put(f"{API}/cost/assumptions", json={"assumptions": {"batch_kg": 800}})
    assert r.status_code == 200 and r.json()["assumptions"]["batch_kg"] == 800
    s.put(f"{API}/cost/assumptions", json={"assumptions": {"batch_kg": 1000}})
    assert s.get(f"{API}/cost/assumptions").json()["assumptions"]["batch_kg"] == 1000
    assert s.put(f"{API}/cost/assumptions", json={"assumptions": {"batch_kg": -1}}).status_code == 422
    assert s.put(f"{API}/cost/assumptions", json={"assumptions": {"bogus": 1}}).status_code == 422


# --- conventional sources CRUD + CSV
def test_conventional_crud(s):
    lst = s.get(f"{API}/conventional").json()["sources"]
    assert len(lst) >= 6
    name = f"TEST_src_{uuid.uuid4().hex[:4]}"
    body = {"name": name, "key": "testsrc1", "price_low": 100, "price_typical": 120, "price_high": 150, "protein_pct": 50, "digestibility": 0.9}
    r = s.post(f"{API}/conventional", json=body)
    assert r.status_code == 200
    cid = r.json()["id"]
    assert any(x["id"] == cid for x in s.get(f"{API}/conventional").json()["sources"])
    u = s.put(f"{API}/conventional/{cid}", json={**body, "price_typical": 130})
    assert u.status_code == 200 and u.json()["price_typical"] == 130
    assert s.post(f"{API}/conventional", json={**body, "price_low": 200}).status_code == 422
    assert s.put(f"{API}/conventional/missing", json=body).status_code == 404
    s.delete(f"{API}/conventional/{cid}")
    assert not any(x["id"] == cid for x in s.get(f"{API}/conventional").json()["sources"])


def test_conventional_template_and_import(s):
    t = s.get(f"{API}/conventional/template")
    assert t.status_code == 200 and "text/csv" in t.headers["content-type"] and "price_typical" in t.text
    csv = "name,key,currency,price_low,price_typical,price_high,protein_pct,digestibility\nTEST_csv_src,testcsv1,USD,1,1.2,1.5,40,0.8\nTEST_bad,testbad1,INR,50,40,60,40,0.8\n"
    r = s.post(f"{API}/conventional/import", files={"file": ("x.csv", csv, "text/csv")})
    assert r.status_code == 200
    d = r.json()
    assert d["imported"] == 1 and len(d["errors"]) == 1
    row = [x for x in s.get(f"{API}/conventional").json()["sources"] if x["key"] == "testcsv1"]
    assert row and abs(row[0]["price_typical"] - 100) < 1  # USD 1.2 / 0.012
    s.delete(f"{API}/conventional/{row[0]['id']}")
    assert s.post(f"{API}/conventional/import", files={"file": ("x.csv", "a,b\n1,2\n", "text/csv")}).status_code == 422


# --- comparison
def test_comparison(s):
    r = s.post(f"{API}/comparison", json={})
    assert r.status_code == 200
    d = r.json()
    assert d["items"] and d.get("caveat")
    assert s.post(f"{API}/comparison", json={"fix_mode": "x"}).status_code == 422


def test_live_prices_stub(s):
    assert s.get(f"{API}/prices/live").json()["available"] is False


# --- PDFs
def test_hub_pdf(s, ids):
    r = s.get(f"{API}/hub/pdf", params={"sample_id": ids["DEMO-FIX-01"], "batch_kg": 1000})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content[:4] == b"%PDF"
    r2 = s.get(f"{API}/hub/pdf", params={"byproduct": "guar_meal"})
    assert r2.status_code == 200 and r2.content[:4] == b"%PDF"


HEADINGS = ["Fix finder", "Fix trade-offs", "Multi-criteria ranking", "Mass flow", "Cost build-up", "Scenario comparison", "Cost per kg digestible protein"]


COMMON = ["Multi-criteria ranking", "Mass flow", "Cost build-up", "Scenario comparison", "Cost per kg digestible protein"]


# fix finder only when problems exist; fix radar only when a fix stack exists (by design)
@pytest.mark.parametrize("code,heads", [("DEMO-FIX-01", HEADINGS), ("DEMO-AFLA-01", COMMON + ["Fix finder"]), ("DEMO-CLEAN-01", COMMON)])
def test_report_pdf_headings(s, ids, code, heads):
    r = s.get(f"{API}/report/{ids[code]}/pdf")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    text, _ = pdf_text(r.content)
    low = text.lower()
    missing = [h for h in heads if h.lower() not in low]
    assert not missing, f"{code} missing {missing}"
    bad = [b for b in BANNED if b in low]
    assert not bad, f"{code} banned phrase {bad}"


def test_report_pdf_all_samples(s, ids):
    fails = []
    for code, sid in ids.items():
        r = s.get(f"{API}/report/{sid}/pdf")
        if r.status_code != 200 or r.content[:4] != b"%PDF":
            fails.append((code, r.status_code))
    assert not fails, fails


# --- regression
@pytest.mark.parametrize("path", ["/samples", "/blend/sources", "/fixes", "/conventional", "/dashboard", "/compare", "/thresholds"])
def test_regression_get(s, path):
    assert s.get(f"{API}{path}").status_code == 200


def test_regression_report_has_cost_summary(s, ids):
    d = s.get(f"{API}/report/{ids['DEMO-FIX-01']}").json()
    assert "cost_summary" in d


def test_rejected_pdf_kpis_do_not_claim_product(s, ids):
    """Safety-blocked sample: KPI table should not show a projected product yield after fixes."""
    text, _ = pdf_text(s.get(f"{API}/report/{ids['DEMO-AFLA-01']}/pdf").content)
    seg = text[text.find("Fixes and cost"):text.find("Fix finder")]
    assert "980 kg of 1,000 kg" not in seg and "Mass yield after fixes" not in seg, seg
