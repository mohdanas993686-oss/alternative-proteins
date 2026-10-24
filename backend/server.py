from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import io
import json
import logging
import os
import threading
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
from ml import predictor
from ml.synth import BYPRODUCTS, WAVELENGTHS, simulate_scan, TARGETS
from ml.train import train_all, train_dataset, spectral_columns, METRICS, metrics as calc_metrics
from ml.generate_data import DATASET

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="ByProduct Analyser API (DEMO DATA)",
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
    return rules.build_report(sid)


@api.get("/report/{sid}/pdf")
def report_pdf_ep(sid: str):
    get_sample_or_404(sid)
    r = rules.build_report(sid)
    pdf = report_pdf.render(r)
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
    df = pd.read_csv(DATASET).groupby("byproduct").head(12)
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
    return {"mode": "evaluate", "n_rows": len(df), "results": rows}


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
