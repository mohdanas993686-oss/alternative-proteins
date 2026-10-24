from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import io
import json
import logging
import os
import threading
from datetime import date
from typing import List, Optional, Literal
import numpy as np
import pandas as pd
from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel, Field, field_validator
from starlette.middleware.cors import CORSMiddleware

import db
import rules
import agent
import report_pdf
import seed
import blend
import fixes as fx
import costs
import hub_pdf
from ml import predictor
from ml.synth import BYPRODUCTS, WAVELENGTHS, simulate_scan, TARGETS
from ml.train import train_all, train_dataset, spectral_columns, METRICS, metrics as calc_metrics
from ml.generate_data import DATASET

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="ByProduct Analyser API (DEMO DATA)", docs_url="/api/docs", redoc_url="/api/redoc", openapi_url="/api/openapi.json",
              description="NIR composition prediction, rule-based safety screening and agentic analysis. "
                          "Trained on synthetic data. Does not certify food safety.")
api = APIRouter(prefix="/api")
TRAIN = {"status": "idle", "progress": 0.0, "message": "", "started_at": None, "finished_at": None}
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


# ---------------- models ----------------
class SampleIn(BaseModel):
    sample_code: Optional[str] = None
    byproduct: str
    supplier: str = Field(min_length=1, max_length=120)
    batch: str = Field(min_length=1, max_length=60)
    sample_date: str
    storage_history: Optional[str] = ""
    notes: Optional[str] = ""
    spectrum: Optional[List[float]] = None
    wavelengths: Optional[List[float]] = None
    spectrum_source: Optional[str] = None

    @field_validator("byproduct")
    @classmethod
    def _bp(cls, v):
        if v not in BYPRODUCTS:
            raise ValueError(f"byproduct must be one of {list(BYPRODUCTS)}")
        return v


class PredictIn(BaseModel):
    byproduct: str
    spectrum: List[float] = Field(min_length=20)
    wavelengths: Optional[List[float]] = None


class LabResult(BaseModel):
    target: str
    value: Optional[float] = None
    result: Optional[Literal["detected", "not_detected", "inconclusive"]] = None
    unit: Optional[str] = None
    method: Optional[str] = None
    confirmation: Optional[str] = None
    notes: Optional[str] = None


class LabResultsIn(BaseModel):
    sample_id: str
    results: List[LabResult] = Field(min_length=1)


class ScanIn(BaseModel):
    byproduct: str


class ReviewIn(BaseModel):
    note: Optional[str] = ""


class AgentRunIn(BaseModel):
    sample_id: str
    provider: str = "claude"


class AgentChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    session_id: str
    sample_id: Optional[str] = None
    provider: str = "claude"


class BlendComponent(BaseModel):
    source_id: str
    percent: float = Field(gt=0, le=100)


class BlendIn(BaseModel):
    components: List[BlendComponent] = Field(min_length=2, max_length=5)


class FixIn(BaseModel):
    problem: str
    method: str = Field(min_length=1, max_length=40)
    action: str = Field(min_length=2, max_length=160)
    byproducts: List[str] = Field(min_length=1)
    cost_low: float = Field(ge=0)
    cost_typical: float = Field(ge=0)
    cost_high: float = Field(ge=0)
    protein_recovery: float = Field(ge=0, le=1)
    mass_yield: float = Field(ge=0, le=1)
    time_h: float = Field(ge=0)
    equipment: str = ""
    retest: List[str] = []
    status: str
    effectiveness: Optional[float] = Field(default=None, ge=0, le=100)
    scale_ease: float = Field(default=60, ge=0, le=100)
    digestibility_gain: float = Field(default=0, ge=0, le=0.3)
    effects: dict = {}
    side_stream: str = "Loss"
    note: str = ""

    @field_validator("problem")
    @classmethod
    def _pr(cls, v):
        if v not in fx.PROBLEMS:
            raise ValueError(f"problem must be one of {list(fx.PROBLEMS)}")
        return v

    @field_validator("status")
    @classmethod
    def _st(cls, v):
        if v not in fx.STATUSES:
            raise ValueError(f"status must be one of {fx.STATUSES}")
        return v


OVERRIDE_KEYS = {"batch_kg", "raw_price", "yield_pct", "failure_prob", "scale", "fix_cost_mult", "testing_mult", "labour_per_kg",
                 "energy_per_kg", "packaging_per_kg", "overhead_pct", "transport_per_kg", "digestibility", "raw_price_mult"}


class EstimateIn(BaseModel):
    sample_id: Optional[str] = None
    byproduct: Optional[str] = None
    fixes: Optional[List[str]] = None
    overrides: dict = {}
    scenario: Optional[str] = None


class ScenarioIn(EstimateIn):
    name: str = Field(min_length=1, max_length=80)


class ConvIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    key: Optional[str] = None
    price_low: float = Field(gt=0)
    price_typical: float = Field(gt=0)
    price_high: float = Field(gt=0)
    protein_pct: float = Field(gt=0, le=100)
    digestibility: float = Field(gt=0, le=1.2)
    quality_basis: str = ""
    allergen_risk: float = Field(default=1, ge=0, le=3)
    allergen_note: str = ""
    flavour: float = Field(default=60, ge=0, le=100)
    supply: float = Field(default=70, ge=0, le=100)
    regulatory: float = Field(default=80, ge=0, le=100)
    price_source: str = "User entry"
    price_date: Optional[str] = None
    assumption: str = "Assumption: verify"


class RetestIn(BaseModel):
    fixes: List[str] = []
    note: Optional[str] = ""


ALL_LAB_TARGETS = set(rules.COMPOSITION) | set(rules.ANF) | set(rules.SAFETY_NUMERIC) | set(rules.PATHOGENS) | \
    set(rules.ALLERGENS) | set(rules.NOTES)


def get_sample_or_404(sid):
    s = db.one("SELECT * FROM samples WHERE id=?", (sid,))
    if not s:
        raise HTTPException(404, "Sample not found")
    return s


# ---------------- routes ----------------
@api.get("/")
def root():
    return {"app": "ByProduct Analyser", "demo_data": True}


@api.get("/byproducts")
def byproducts():
    return [{"key": k, "label": v["label"], "inherent_allergens": v["allergens"],
             "typical": {t: v[t] for t in ("protein", "oil", "moisture", "fibre_total", "phytate", "tannins", "trypsin_inhibitor")}}
            for k, v in BYPRODUCTS.items()]


@api.get("/catalog")
def catalog():
    return {"composition": rules.COMPOSITION, "anf": rules.ANF, "safety_numeric": rules.SAFETY_NUMERIC,
            "pathogens": rules.PATHOGENS, "allergens": rules.ALLERGENS}


@api.post("/simulate-scan")
def simulate(body: ScanIn):
    if body.byproduct not in BYPRODUCTS:
        raise HTTPException(422, "Unknown by-product")
    spec, _ = simulate_scan(body.byproduct)
    return {"wavelengths": WAVELENGTHS.tolist(), "spectrum": [round(float(x), 6) for x in spec], "source": "Simulated NIR scan"}


@api.post("/spectrum/parse")
async def parse_spectrum(file: UploadFile = File(...)):
    raw = (await file.read()).decode("utf-8", errors="ignore")
    try:
        df = pd.read_csv(io.StringIO(raw))
        cols = {c.lower().strip(): c for c in df.columns}
        if "wavelength" in cols and "absorbance" in cols:
            w, a = df[cols["wavelength"]].astype(float).values, df[cols["absorbance"]].astype(float).values
        elif spectral_columns(df):
            wc = spectral_columns(df)
            w = np.array([float(str(c).replace("w_", "")) for c in wc])
            a = df[wc].astype(float).mean(axis=0).values
        else:
            df = pd.read_csv(io.StringIO(raw), header=None)
            w, a = df.iloc[:, 0].astype(float).values, df.iloc[:, 1].astype(float).values
    except Exception:
        raise HTTPException(422, "Could not read the CSV. Use two columns 'wavelength,absorbance' (900-1700 nm).")
    if len(a) < 20 or w.min() > 1000 or w.max() < 1600:
        raise HTTPException(422, "Spectrum must have at least 20 points covering roughly 900-1700 nm.")
    grid = predictor.to_grid(a, w)
    return {"wavelengths": WAVELENGTHS.tolist(), "spectrum": [round(float(x), 6) for x in grid], "source": f"Uploaded CSV ({file.filename})"}


@api.post("/predict")
def predict(body: PredictIn):
    if body.byproduct not in BYPRODUCTS:
        raise HTTPException(422, "Unknown by-product")
    return {"byproduct": body.byproduct, "predictions": predictor.predict(predictor.to_grid(body.spectrum, body.wavelengths), body.byproduct),
            "demo_data": True, "note": "AI predictions from models trained on synthetic data."}


@api.post("/samples")
def create_sample(body: SampleIn):
    spec = predictor.to_grid(body.spectrum, body.wavelengths) if body.spectrum else None
    n = db.one("SELECT COUNT(*) n FROM samples")["n"]
    code = body.sample_code or f"{body.byproduct[:3].upper()}-{n + 201}"
    if db.one("SELECT id FROM samples WHERE lower(sample_code)=lower(?)", (code,)):
        raise HTTPException(409, f"Sample ID '{code}' already exists")
    sid = seed.create_sample(code, body.byproduct, body.supplier, body.batch, body.sample_date, body.storage_history,
                             body.notes, spec, body.spectrum_source or ("Uploaded" if spec is not None else None), is_demo=1)
    return rules.sample_public(db.one("SELECT * FROM samples WHERE id=?", (sid,)))


@api.get("/samples")
def list_samples():
    out = []
    for s in db.query("SELECT * FROM samples ORDER BY created_at DESC"):
        r = rules.build_report(s["id"])
        prot = next((c for c in r["composition"] if c["key"] == "protein"), {})
        out.append({**r["sample"], "overall_status": r["overall_status"], "score": r["suitability"]["score"],
                    "protein": prot.get("value"), "protein_source": prot.get("source"),
                    "n_retests": len(r["retests"]), "human_review_required": r["human_review_required"]})
    return out


@api.get("/samples/{sid}")
def get_sample(sid: str):
    get_sample_or_404(sid)
    return rules.build_report(sid)


@api.post("/samples/{sid}/review")
def request_review(sid: str, body: ReviewIn):
    get_sample_or_404(sid)
    db.execute("UPDATE samples SET review_status='pending_human_review', review_note=? WHERE id=?", (body.note, sid))
    db.insert("agent_logs", {"id": db.new_id(), "run_id": "human-review", "sample_id": sid, "step": 0, "kind": "escalation",
                             "tool": None, "args": json.dumps({"note": body.note}), "result": None,
                             "reasoning": "Escalated to human reviewer by user.", "created_at": db.now()})
    return {"ok": True, "review_status": "pending_human_review"}


@api.post("/lab-results")
def add_lab_results(body: LabResultsIn):
    get_sample_or_404(body.sample_id)
    errors = []
    for i, r in enumerate(body.results):
        if r.target not in ALL_LAB_TARGETS:
            errors.append(f"Unknown target '{r.target}'")
        if r.value is not None and r.value < 0:
            errors.append(f"{r.target}: value cannot be negative")
        if r.target == "water_activity" and r.value is not None and r.value > 1:
            errors.append("Water activity must be between 0 and 1")
        if r.target in rules.PATHOGENS and not r.result:
            errors.append(f"{r.target}: choose detected / not detected / inconclusive")
    if errors:
        raise HTTPException(422, "; ".join(errors))
    for r in body.results:
        db.insert("lab_results", {"id": db.new_id(), "sample_id": body.sample_id, **r.model_dump(), "created_at": db.now()})
    return {"ok": True, "saved": len(body.results)}


@api.get("/report/{sid}")
def report(sid: str):
    get_sample_or_404(sid)
    r = rules.build_report(sid)
    r["cost_summary"] = costs.report_summary(r)
    return r


def _fix_rows(est):
    cat = fx.catalogue_map()
    return [[f["action"], f"{f['cost_low']:g}-{f['cost_high']:g}", f"{f['protein_loss_pct']:g}%", ", ".join(f["retest"]) or "-"]
            for f in (cat[i] for i in est["fixes_used"] if i in cat)]


@api.get("/report/{sid}/pdf")
def report_pdf_ep(sid: str):
    get_sample_or_404(sid)
    r = rules.build_report(sid)
    r["cost_summary"] = costs.report_summary(r)
    est = costs.estimate({"sample_id": sid}, None, {}, light=True)
    est["fix_rows"] = _fix_rows(est)
    pdf = report_pdf.render(r, hub_pdf.cost_section(est, costs.comparison()))
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="report_{r["sample"]["sample_code"]}.pdf"'})


@api.get("/dashboard")
def dashboard():
    samples = list_samples()
    prots = [s["protein"] for s in samples if s["protein"] is not None]
    dist = {k: sum(s["overall_status"] == k for s in samples) for k in rules.RANK}
    return {"samples_analysed": len(samples), "flagged": sum(s["overall_status"] in ("FAIL", "RETEST") for s in samples),
            "avg_protein": round(sum(prots) / len(prots), 1) if prots else None,
            "review_pending": sum(s["review_status"] == "pending_human_review" for s in samples),
            "status_distribution": dist, "recent": samples[:6], "demo_data": True}


@api.get("/compare")
def compare():
    reps = [rules.build_report(s["id"]) for s in db.query("SELECT id FROM samples")]
    return {"ranking": agent.compare_types(reps), "demo_data": True}


@api.get("/blend/sources")
def blend_sources():
    return blend.sources()


@api.post("/blend")
def blend_calc(body: BlendIn):
    ids = [c.source_id for c in body.components]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "Each component can only be added once.")
    total = sum(c.percent for c in body.components)
    if abs(total - 100) > 0.5:
        raise HTTPException(422, f"Percentages must add up to 100% (currently {total:.1f}%).")
    try:
        return blend.blend([c.model_dump() for c in body.components])
    except ValueError as e:
        raise HTTPException(422, str(e))


# ---------------- fixes & costs (placeholder INR) ----------------
@api.get("/fixes")
def list_fixes():
    return {"fixes": fx.catalogue(), "problems": fx.PROBLEMS, "statuses": fx.STATUSES, "test_lines": fx.TEST_LINES,
            "note": "Illustrative, replace with real quotes. Safety failures have no reprocessing fix."}


@api.post("/fixes")
def create_fix(body: FixIn):
    return fx.save_fix(body.model_dump())


@api.put("/fixes/{fid}")
def update_fix(fid: str, body: FixIn):
    if not fx.get_fix(fid):
        raise HTTPException(404, "Fix not found")
    return fx.save_fix(body.model_dump(), fid)


@api.delete("/fixes/{fid}")
def delete_fix(fid: str):
    if not fx.get_fix(fid):
        raise HTTPException(404, "Fix not found")
    db.execute("DELETE FROM fix_catalogue WHERE id=?", (fid,))
    return {"ok": True}


@api.get("/samples/{sid}/fix-options")
def fix_options(sid: str):
    get_sample_or_404(sid)
    est = costs.estimate({"sample_id": sid}, None, {}, light=True)
    return {k: est[k] for k in ("problems", "options", "recommended", "safety_block", "profile")}


@api.post("/samples/{sid}/retest-sample")
def retest_sample(sid: str, body: RetestIn):
    s = get_sample_or_404(sid)
    n = db.one("SELECT COUNT(*) n FROM samples WHERE parent_sample_id=?", (sid,))["n"] + 1
    cat = fx.catalogue_map()
    acts = [cat[i]["action"] for i in body.fixes if i in cat]
    code = f"{s['sample_code']}-R{n}"
    while db.one("SELECT id FROM samples WHERE lower(sample_code)=lower(?)", (code,)):
        n += 1
        code = f"{s['sample_code']}-R{n}"
    new = seed.create_sample(code, s["byproduct"], s["supplier"], s["batch"], date.today().isoformat(),
                             (s["storage_history"] or "") + (f" | After fixes: {', '.join(acts)}" if acts else ""),
                             f"Independent retest sample of {s['sample_code']}. Original results are kept unchanged. {body.note or ''}".strip(),
                             None, None, is_demo=1)
    db.execute("UPDATE samples SET parent_sample_id=? WHERE id=?", (sid, new))
    return rules.sample_public(db.one("SELECT * FROM samples WHERE id=?", (new,)))


@api.get("/cost/assumptions")
def get_assumptions():
    return {"assumptions": fx.assumptions(), "note": "PLACEHOLDER INR values. Illustrative, replace with real quotes."}


@api.put("/cost/assumptions")
def put_assumptions(body: dict):
    a = body.get("assumptions", body)
    cur = fx.assumptions()
    def check(path, v):
        if isinstance(v, dict):
            for k, x in v.items():
                check(f"{path}.{k}", x)
        elif isinstance(v, bool) or not isinstance(v, (int, float, str)) or (isinstance(v, (int, float)) and v < 0):
            raise HTTPException(422, f"{path} must be a non-negative number")
    for k, v in a.items():
        if k not in cur:
            raise HTTPException(422, f"Unknown assumption '{k}'")
        check(k, v)
        cur[k] = {**cur[k], **v} if isinstance(cur[k], dict) and isinstance(v, dict) else v
    if cur["scale"] not in ("auto", "lab", "pilot", "industrial"):
        raise HTTPException(422, "scale must be auto, lab, pilot or industrial")
    fx.save_assumptions(cur)
    return {"assumptions": cur}


def _clean_overrides(o):
    out = {}
    for k, v in (o or {}).items():
        if k not in OVERRIDE_KEYS or v is None or v == "":
            continue
        if k == "scale":
            if v not in ("auto", "lab", "pilot", "industrial"):
                raise HTTPException(422, "scale must be auto, lab, pilot or industrial")
            out[k] = v
            continue
        try:
            v = float(v)
        except (TypeError, ValueError):
            raise HTTPException(422, f"{k} must be a number")
        if v < 0 or (k == "batch_kg" and v < 1) or (k == "yield_pct" and not 1 <= v <= 100) or (k == "failure_prob" and v > 1):
            raise HTTPException(422, f"{k} is out of range")
        out[k] = v
    return out


def _estimate(body, light=False):
    if body.sample_id:
        get_sample_or_404(body.sample_id)
    try:
        return costs.estimate({"sample_id": body.sample_id, "byproduct": body.byproduct}, body.fixes, _clean_overrides(body.overrides),
                              body.scenario, light=light)
    except ValueError as e:
        raise HTTPException(422, str(e))


@api.post("/cost/estimate")
def cost_estimate(body: EstimateIn):
    return _estimate(body)


def _scenario_summary(est):
    m = est["metrics"]
    sel = m[est["scenario"]] if est["scenario"] != "rejected" else m["fixes"]
    return {"scenario": est["scenario"], "label": est["profile"]["label"], "per_kg_dig": sel.get("per_kg_dig"),
            "expected_per_kg_dig": m["expected"]["per_kg_dig"], "total": sel["total"], "batch_kg": est["batch_kg"],
            "batch_curve": est["batch_curve"], "p10": est["monte_carlo"]["p10"], "p50": est["monte_carlo"]["p50"], "p90": est["monte_carlo"]["p90"]}


def _scenario_out(r):
    return {**r, "context": json.loads(r["context"]), "fixes": json.loads(r["fixes"]) if r["fixes"] else None,
            "overrides": json.loads(r["overrides"]), "summary": json.loads(r["summary"])}


@api.get("/cost/scenarios")
def list_scenarios():
    return [_scenario_out(r) for r in db.query("SELECT * FROM saved_scenarios ORDER BY created_at")]


def save_scenario(body: ScenarioIn):
    est = _estimate(body)
    row = {"id": db.new_id(), "name": body.name, "context": json.dumps({"sample_id": body.sample_id, "byproduct": body.byproduct}),
           "fixes": json.dumps(est["fixes_used"]), "overrides": json.dumps(_clean_overrides(body.overrides)),
           "summary": json.dumps(_scenario_summary(est)), "created_at": db.now()}
    db.insert("saved_scenarios", row)
    return _scenario_out(row)


api.post("/cost/scenarios")(save_scenario)


@api.delete("/cost/scenarios/{scid}")
def delete_scenario(scid: str):
    db.execute("DELETE FROM saved_scenarios WHERE id=?", (scid,))
    return {"ok": True}


@api.get("/conventional")
def list_conventional():
    return {"sources": fx.conventional(), "note": "PLACEHOLDER INR prices. Assumption: verify. Not market data."}


def _conv_row(b: ConvIn):
    d = b.model_dump()
    d["key"] = d["key"] or "".join(ch for ch in d["name"].lower() if ch.isalnum())[:12]
    d["price_date"] = d["price_date"] or date.today().isoformat()
    if not d["price_low"] <= d["price_typical"] <= d["price_high"]:
        raise HTTPException(422, "Prices must satisfy low <= typical <= high")
    return d


@api.post("/conventional")
def create_conventional(body: ConvIn):
    d = _conv_row(body)
    row = {"id": db.new_id(), **d, "placeholder": 0, "created_at": db.now(), "updated_at": db.now()}
    db.insert("conventional_sources", row)
    return row


@api.put("/conventional/{cid}")
def update_conventional(cid: str, body: ConvIn):
    if not db.one("SELECT id FROM conventional_sources WHERE id=?", (cid,)):
        raise HTTPException(404, "Source not found")
    d = _conv_row(body)
    sets = ",".join(f"{k}=?" for k in d)
    db.execute(f"UPDATE conventional_sources SET {sets}, placeholder=0, updated_at=? WHERE id=?", (*d.values(), db.now(), cid))
    return db.one("SELECT * FROM conventional_sources WHERE id=?", (cid,))


@api.delete("/conventional/{cid}")
def delete_conventional(cid: str):
    db.execute("DELETE FROM conventional_sources WHERE id=?", (cid,))
    return {"ok": True}


@api.get("/conventional/template")
def conventional_template():
    df = pd.DataFrame(fx.conventional())[list(fx.CONV_FIELDS)]
    df.insert(1, "currency", "INR")
    return Response(df.to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="conventional_prices_PLACEHOLDER.csv"'})


@api.post("/conventional/import")
def import_conventional(file: UploadFile = File(...)):
    try:
        df = pd.read_csv(file.file)
    except Exception:
        raise HTTPException(422, "Could not read CSV file.")
    need = {"name", "price_low", "price_typical", "price_high", "protein_pct", "digestibility"}
    if not need <= set(df.columns):
        raise HTTPException(422, f"CSV needs columns: {', '.join(sorted(need))} (optional: key, currency, quality_basis, allergen_risk, flavour, supply, regulatory, price_source, price_date)")
    fxr = fx.assumptions()["fx_per_inr"]
    done, errors = 0, []
    for i, r in df.fillna("").iterrows():
        cur = str(r.get("currency") or "INR").upper()
        if cur not in fxr:
            errors.append(f"row {i + 2}: unknown currency {cur}")
            continue
        conv = 1 / fxr[cur]
        try:
            b = ConvIn(**{k: r[k] for k in fx.CONV_FIELDS if k in df.columns and r[k] != "" and k not in ("price_low", "price_typical", "price_high")},
                       **{k: float(r[k]) * conv for k in ("price_low", "price_typical", "price_high")})
            d = _conv_row(b)
        except Exception as e:
            errors.append(f"row {i + 2}: {getattr(e, 'detail', None) or str(e).splitlines()[0]}")
            continue
        ph = int("PLACEHOLDER" in (d["price_source"] or "").upper())
        ex = db.one("SELECT id FROM conventional_sources WHERE lower(key)=lower(?) OR lower(name)=lower(?)", (d["key"], d["name"]))
        if ex:
            sets = ",".join(f"{k}=?" for k in d)
            db.execute(f"UPDATE conventional_sources SET {sets}, placeholder=?, updated_at=? WHERE id=?", (*d.values(), ph, db.now(), ex["id"]))
        else:
            db.insert("conventional_sources", {"id": db.new_id(), **d, "placeholder": ph, "created_at": db.now(), "updated_at": db.now()})
        done += 1
    return {"imported": done, "errors": errors}


@api.get("/prices/live")
def live_prices():
    if not os.environ.get("PRICE_API_KEY"):
        return {"available": False, "message": "No live price API connected (set PRICE_API_KEY). Using editable placeholder prices."}
    return {"available": True, "message": "PRICE_API_KEY found. This is a stub: connect a price provider in server.py live_prices(). Prices are unchanged."}


@api.post("/comparison")
def comparison(body: dict = None):
    body = body or {}
    mode = body.get("fix_mode", "recommended")
    if mode not in ("recommended", "none"):
        raise HTTPException(422, "fix_mode must be 'recommended' or 'none'")
    return costs.comparison(_clean_overrides(body.get("overrides")), mode)


@api.get("/hub/pdf")
def hub_pdf_ep(sample_id: Optional[str] = None, byproduct: Optional[str] = None, fixes: Optional[str] = None,
               scenario: Optional[str] = None, batch_kg: Optional[float] = None, raw_price: Optional[float] = None,
               yield_pct: Optional[float] = None, failure_prob: Optional[float] = None):
    body = EstimateIn(sample_id=sample_id, byproduct=byproduct, fixes=[f for f in fixes.split(",") if f] if fixes is not None else None,
                      overrides={"batch_kg": batch_kg, "raw_price": raw_price, "yield_pct": yield_pct, "failure_prob": failure_prob}, scenario=scenario)
    est = _estimate(body)
    est["fix_rows"] = _fix_rows(est)
    pdf = hub_pdf.render_hub(est, costs.comparison(), est["profile"]["label"])
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="cost_fix_hub_DEMO.pdf"'})


@api.get("/thresholds")
def get_thresholds():
    return {"thresholds": rules.thresholds(), "note": "Placeholder values. Check current FSSAI requirements before use."}


@api.put("/thresholds")
def put_thresholds(body: dict):
    t = body.get("thresholds", body)
    cur = rules.thresholds()
    for k, v in t.items():
        if k not in cur:
            raise HTTPException(422, f"Unknown threshold '{k}'")
        for f, val in v.items():
            if f != "unit" and (not isinstance(val, (int, float)) or val < 0):
                raise HTTPException(422, f"{k}.{f} must be a non-negative number")
        cur[k] = {**cur[k], **v}
    rules.save_thresholds(cur)
    return {"thresholds": cur}


# ---------------- model training ----------------
def _run_training():
    def prog(p, msg):
        TRAIN.update(progress=round(p, 3), message=msg)
    try:
        TRAIN.update(status="running", progress=0.0, message="Loading dataset", started_at=db.now(), finished_at=None)
        train_all(prog)
        predictor.reload()
        TRAIN.update(status="completed", progress=1.0, message="Training complete", finished_at=db.now())
    except Exception as e:
        logger.exception("training failed")
        TRAIN.update(status="failed", message=str(e), finished_at=db.now())


@api.post("/train")
def train():
    if TRAIN["status"] == "running":
        raise HTTPException(409, "Training already running")
    TRAIN.update(status="running", progress=0.0, message="Starting")
    threading.Thread(target=_run_training, daemon=True).start()
    return TRAIN


@api.get("/train/status")
def train_status():
    return TRAIN


@api.get("/train/template")
def train_template():
    df = pd.read_csv(DATASET).groupby("byproduct").tail(40)
    return Response(df.to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="byproduct_template_DEMO.csv"'})


@api.post("/train/upload")
def train_upload(file: UploadFile = File(...), mode: str = Form("evaluate")):
    try:
        df = pd.read_csv(file.file)
    except Exception:
        raise HTTPException(422, "Could not read CSV file.")
    wcols = spectral_columns(df)
    targets = [t for t in TARGETS if t in df.columns]
    if "byproduct" not in df.columns or len(wcols) < 20 or not targets:
        raise HTTPException(422, "CSV needs a 'byproduct' column, >= 20 wavelength columns (e.g. 900.0 ... 1700.0) and at least one target column (e.g. protein).")
    bad = set(df["byproduct"]) - set(BYPRODUCTS)
    if bad:
        raise HTTPException(422, f"Unknown by-product values: {sorted(bad)}")
    if mode == "train":
        out = train_dataset(df.copy(), save=False)
        if not out["best"]:
            raise HTTPException(422, "Not enough data to train: each by-product needs at least 15 rows from at least 5 different batch_id values.")
        return {"mode": "train", "n_rows": len(df), "results": out["results"],
                "best": {k: {kk: vv for kk, vv in v.items() if kk not in ("test_ids",)} for k, v in out["best"].items()},
                "note": "Sandbox training only: production models were not replaced."}
    w = np.array([float(str(c).replace("w_", "")) for c in wcols])
    rows = []
    for bp, sub in df.groupby("byproduct"):
        preds = [{p["target"]: p["value"] for p in predictor.predict(predictor.to_grid(r, w), bp)} for r in sub[wcols].values]
        for t in targets:
            y = sub[t].values
            p = np.array([pp.get(t, np.nan) for pp in preds])
            ok = ~np.isnan(y) & ~np.isnan(p)
            if ok.sum() >= 2:
                rows.append({"target": t, "byproduct": bp, "n": int(ok.sum()), **calc_metrics(y[ok], p[ok]),
                             "measured": y[ok].round(3).tolist(), "predicted": p[ok].round(3).tolist()})
    return {"mode": "evaluate", "n_rows": len(df), "results": rows,
            "note": "Evaluated against current models. If rows come from the template/training set, metrics will look optimistic."}


@api.get("/model/metrics")
def model_metrics():
    m = predictor.load_metrics()
    if not m:
        raise HTTPException(404, "No trained models yet")
    return m


# ---------------- agent ----------------
@api.get("/agent/status")
def agent_status():
    return {"llm_available": agent.llm_available(),
            "providers": [{"key": k, "label": v[2]} for k, v in agent.PROVIDERS.items()]}


@api.post("/agent/run")
def agent_run(body: AgentRunIn):
    get_sample_or_404(body.sample_id)
    return StreamingResponse(agent.full_analysis(body.sample_id, body.provider), media_type="text/event-stream", headers=SSE_HEADERS)


@api.post("/agent/chat")
def agent_chat(body: AgentChatIn):
    if body.sample_id:
        get_sample_or_404(body.sample_id)
    return StreamingResponse(agent.chat(body.message, body.session_id, body.sample_id, body.provider),
                             media_type="text/event-stream", headers=SSE_HEADERS)


@api.get("/agent/logs")
def agent_logs(sample_id: Optional[str] = None, limit: int = 100):
    if sample_id:
        rows = db.query("SELECT * FROM agent_logs WHERE sample_id=? ORDER BY created_at DESC LIMIT ?", (sample_id, limit))
    else:
        rows = db.query("SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT ?", (limit,))
    for r in rows:
        r["result"] = (r["result"] or "")[:600]
    return rows


@api.get("/agent/history/{session_id}")
def agent_history(session_id: str):
    return db.query("SELECT role, content, created_at FROM chat_messages WHERE session_id=? ORDER BY created_at", (session_id,))


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def startup():
    db.init()
    if not METRICS.exists():
        logger.info("No models found: generating synthetic data and training (one-off)...")
        train_all()
        predictor.reload()
    seed.seed()
    fx.seed()
    seed.seed_cost_demo()
    if db.one("SELECT COUNT(*) n FROM saved_scenarios")["n"] == 0:
        demo = db.one("SELECT id FROM samples WHERE sample_code='DEMO-FIX-01'")
        if demo:
            for name, b in (("Pilot batch 500 kg", 500), ("Industrial batch 5 t", 5000)):
                save_scenario(ScenarioIn(name=name, sample_id=demo["id"], overrides={"batch_kg": b}))
