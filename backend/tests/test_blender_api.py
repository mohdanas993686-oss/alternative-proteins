# Blender feature API tests: /api/blend/sources and POST /api/blend
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


@pytest.fixture(scope="module")
def s():
    x = requests.Session()
    x.headers.update({"Content-Type": "application/json"})
    return x


@pytest.fixture(scope="module")
def sources(s):
    r = s.get(f"{BASE_URL}/api/blend/sources")
    assert r.status_code == 200
    return r.json()


def by_id(sources):
    return {x["id"]: x for x in sources}


def post(s, comps):
    return s.post(f"{BASE_URL}/api/blend", json={"components": comps})


# Sources listing
class TestSources:
    def test_structure(self, sources):
        kinds = {x["kind"] for x in sources}
        assert kinds == {"byproduct", "sample"}
        types = [x for x in sources if x["kind"] == "byproduct"]
        assert len(types) == 5
        for t in types:
            assert t["id"].startswith("type:") and t["status"] is None and t["n_samples"] > 0
            assert "protein" in t["values"] and "moisture" in t["values"]
        for x in sources:
            if x["kind"] == "sample":
                assert x["status"] in ("PASS", "REVIEW", "RETEST", "FAIL")
                assert x["id"].startswith("sample:")

    def test_type_average_matches_samples(self, sources):
        d = by_id(sources)
        guar = d["type:guar_meal"]
        samples = [x for x in sources if x["kind"] == "sample" and x["byproduct"] == "guar_meal"]
        assert guar["n_samples"] == len(samples)
        avg = sum(x["values"]["protein"] for x in samples) / len(samples)
        assert abs(avg - guar["values"]["protein"]) < 0.01


# Blend computation
class TestBlend:
    def test_default_blend_math(self, s, sources):
        d = by_id(sources)
        a, b = d["type:guar_meal"], d["type:pulse_residue"]
        r = post(s, [{"source_id": a["id"], "percent": 60}, {"source_id": b["id"], "percent": 40}])
        assert r.status_code == 200, r.text
        j = r.json()
        # moisture mass-weighted
        exp_m = 0.6 * a["values"]["moisture"] + 0.4 * b["values"]["moisture"]
        assert abs(j["values"]["moisture"] - exp_m) < 0.01
        # protein DM-weighted
        da, db = 0.6 * (1 - a["values"]["moisture"] / 100), 0.4 * (1 - b["values"]["moisture"] / 100)
        exp_p = (da * a["values"]["protein"] + db * b["values"]["protein"]) / (da + db)
        assert abs(j["values"]["protein"] - exp_p) < 0.01
        # gum counted as 0 for pulse
        exp_g = da * a["values"]["gum"] / (da + db)
        assert abs(j["values"]["gum"] - exp_g) < 0.01
        assert j["status"] == "REVIEW"
        assert j["allergens"] == ["pulse"]
        assert j["demo_data"] is True and "not certified safe" in j["disclaimer"]
        assert len(j["components"]) == 2
        for k, sh in j["contribution_shares"].items():
            assert len(sh) == 2 and abs(sum(sh) - 100) < 0.3, k
        assert 0 <= j["suitability"]["score"] <= 100
        assert any("worst screening status" in n for n in j["notes"])

    def test_identical_split_equals_source(self, s, sources):
        # blending a source with itself is disallowed; instead blend two samples and check value bounded
        smp = [x for x in sources if x["kind"] == "sample"][:2]
        r = post(s, [{"source_id": smp[0]["id"], "percent": 50}, {"source_id": smp[1]["id"], "percent": 50}])
        assert r.status_code == 200
        j = r.json()
        for k in ("protein", "oil", "fibre_total", "phytate"):
            lo = min(smp[0]["values"][k], smp[1]["values"][k]); hi = max(smp[0]["values"][k], smp[1]["values"][k])
            assert lo - 1e-6 <= j["values"][k] <= hi + 1e-6

    def test_fail_component_inherits_fail(self, s, sources):
        fail = next(x for x in sources if x["status"] == "FAIL")
        ok = next(x for x in sources if x["status"] == "PASS")
        r = post(s, [{"source_id": fail["id"], "percent": 5}, {"source_id": ok["id"], "percent": 95}])
        assert r.status_code == 200
        j = r.json()
        assert j["status"] == "FAIL"
        assert j["suitability"]["score"] == 0
        assert j["suitability"]["safety_multiplier"] == 0

    def test_pass_samples_only_is_pass(self, s, sources):
        p = [x for x in sources if x["status"] == "PASS"]
        if len(p) < 2:
            pytest.skip("need 2 PASS samples")
        r = post(s, [{"source_id": p[0]["id"], "percent": 50}, {"source_id": p[1]["id"], "percent": 50}])
        assert r.json()["status"] == "PASS"
        assert not any("By-product averages" in n for n in r.json()["notes"])

    def test_five_components(self, s, sources):
        t = [x["id"] for x in sources if x["kind"] == "byproduct"]
        r = post(s, [{"source_id": i, "percent": 20} for i in t])
        assert r.status_code == 200
        assert set(r.json()["allergens"]) == {"peanut", "almond", "pulse"}

    def test_tolerance_0_5(self, s):
        r = post(s, [{"source_id": "type:guar_meal", "percent": 60.2}, {"source_id": "type:rice_bran", "percent": 40.2}])
        assert r.status_code == 200


# Validation
class TestBlendValidation:
    @pytest.mark.parametrize("comps", [
        [{"source_id": "type:guar_meal", "percent": 50}, {"source_id": "type:rice_bran", "percent": 40}],
        [{"source_id": "type:guar_meal", "percent": 100}],
        [{"source_id": "type:guar_meal", "percent": 50}, {"source_id": "type:guar_meal", "percent": 50}],
        [{"source_id": "type:guar_meal", "percent": 100}, {"source_id": "type:rice_bran", "percent": 0}],
        [{"source_id": "type:nope", "percent": 50}, {"source_id": "type:rice_bran", "percent": 50}],
        [{"source_id": "type:guar_meal", "percent": 150}, {"source_id": "type:rice_bran", "percent": -50}],
        [{"source_id": f"type:x{i}", "percent": 100 / 6} for i in range(6)],
    ])
    def test_rejects(self, s, comps):
        r = post(s, comps)
        assert r.status_code == 422, r.text
        assert "detail" in r.json()

    def test_sum_message(self, s):
        r = post(s, [{"source_id": "type:guar_meal", "percent": 50}, {"source_id": "type:rice_bran", "percent": 40}])
        assert "100%" in r.json()["detail"]

    def test_empty_body(self, s):
        assert s.post(f"{BASE_URL}/api/blend", json={}).status_code == 422
