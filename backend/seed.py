"""Seed demo samples (DEMO DATA) with predictions and varied lab-result scenarios."""
import json
from datetime import date, timedelta, datetime, timezone
import numpy as np
import db
from ml import predictor
from ml.synth import BYPRODUCTS, simulate_scan, spectrum_from_targets

SUPPLIERS = ["Demo Agro Processors (Rajasthan)", "Sample Oil Mills Co. (Gujarat)", "Example Dal Mill (MP)",
             "Placeholder Nut Works (Punjab)", "Test Rice Mills (Andhra Pradesh)"]
STORAGE = ["Jute bags, ambient warehouse, 21 days", "HDPE bags, covered godown, 45 days, monsoon season",
           "Sealed silo, 10 days", "Open shed, 30 days, visible clumping noted", "Cold store 12°C, 7 days"]


def lab(sid, target, value=None, result=None, method=None, confirmation=None, notes=None, unit=None, offset=0):
    ts = (datetime.now(timezone.utc) - timedelta(minutes=offset)).isoformat()
    db.insert("lab_results", {"id": db.new_id(), "sample_id": sid, "target": target, "value": value, "result": result,
                              "unit": unit, "method": method, "confirmation": confirmation, "notes": notes, "created_at": ts})


def scenario(i, sid, t, bp):
    k = i % 7
    if k == 0:  # complete & clean
        lab(sid, "protein", round(t["protein"] + 0.4, 2), method="Kjeldahl")
        lab(sid, "phytate", round(t["phytate"], 2), method="Spectrophotometric")
        lab(sid, "afb1", 2.1, method="HPLC"); lab(sid, "aflatoxin_total", 3.4, method="HPLC")
        lab(sid, "apc", 24000, method="Plate count"); lab(sid, "yeast_mould", 180, method="Plate count")
        lab(sid, "water_activity", 0.54, method="Dew-point meter")
        lab(sid, "salmonella", result="not_detected", method="Culture", confirmation="Confirmed")
        lab(sid, "e_coli", result="not_detected", method="PCR", confirmation="Confirmed")
    elif k == 1:  # screening aflatoxin high
        lab(sid, "afb1", 12.5, method="ELISA"); lab(sid, "aflatoxin_total", 17.8, method="ELISA")
        lab(sid, "apc", 61000, method="Plate count"); lab(sid, "water_activity", 0.62, method="Dew-point meter")
        lab(sid, "salmonella", result="not_detected", method="PCR", confirmation="Pending")
    elif k == 2:  # HPLC aflatoxin fail
        lab(sid, "afb1", 21.4, method="HPLC"); lab(sid, "aflatoxin_total", 29.0, method="HPLC")
        lab(sid, "apc", 88000, method="Plate count"); lab(sid, "yeast_mould", 2400, method="Plate count")
        lab(sid, "water_activity", 0.69, method="Dew-point meter")
        lab(sid, "salmonella", result="not_detected", method="Culture", confirmation="Confirmed")
        lab(sid, "e_coli", result="not_detected", method="Culture", confirmation="Confirmed")
    elif k == 3:  # presumptive salmonella
        lab(sid, "afb1", 3.0, method="Rapid test (lateral flow)"); lab(sid, "aflatoxin_total", 4.2, method="Rapid test (lateral flow)")
        lab(sid, "apc", 150000, method="Plate count"); lab(sid, "yeast_mould", 800, method="Plate count")
        lab(sid, "water_activity", 0.6, method="Dew-point meter")
        lab(sid, "salmonella", result="detected", method="PCR", confirmation="Presumptive")
        lab(sid, "e_coli", result="not_detected", method="PCR", confirmation="Confirmed")
    elif k == 4:  # high micro load
        lab(sid, "afb1", 1.2, method="HPLC"); lab(sid, "aflatoxin_total", 2.0, method="HPLC")
        lab(sid, "apc", 3200000, method="Plate count"); lab(sid, "yeast_mould", 15000, method="Plate count")
        lab(sid, "water_activity", 0.78, method="Dew-point meter"); lab(sid, "moisture", 13.1, method="Oven drying")
        lab(sid, "salmonella", result="inconclusive", method="Immunoassay", confirmation="Pending")
    elif k == 5:  # incomplete
        lab(sid, "afb1", 0, method="Rapid test (lateral flow)")
    else:  # inconsistent entries + lab protein mismatch
        lab(sid, "protein", round(t["protein"] * 0.8, 2), method="Kjeldahl")
        lab(sid, "afb1", 8.0, method="HPLC"); lab(sid, "aflatoxin_total", 6.0, method="HPLC")
        lab(sid, "apc", 40000, method="Plate count"); lab(sid, "yeast_mould", 300, method="Plate count")
        lab(sid, "water_activity", 0.58, method="Dew-point meter")
        lab(sid, "salmonella", result="not_detected", method="Culture", confirmation="Confirmed")
        lab(sid, "e_coli", result="not_detected", method="Culture", confirmation="Confirmed")
        lab(sid, "allergen_almond", result="detected", method="ELISA",
            notes=None if bp == "almond_cake" else "Shared expeller line with almond pressing")
        lab(sid, "cross_contact", notes="Shared conveyor with almond and groundnut lines; cleaning log incomplete.")
    if bp in ("groundnut_cake", "almond_cake", "pulse_residue") and k in (0, 2):
        name = {"groundnut_cake": "allergen_peanut", "almond_cake": "allergen_almond", "pulse_residue": "allergen_pulse"}[bp]
        lab(sid, name, result="detected", method="ELISA")
    if k in (0, 3):
        lab(sid, "supplier_notes", notes="Supplier declares dedicated line; supply-chain verification pending.")


def create_sample(code, bp, supplier, batch, sample_date, storage, notes, spectrum, source, is_demo=1):
    sid = db.new_id()
    db.insert("samples", {"id": sid, "sample_code": code, "byproduct": bp, "supplier": supplier, "batch": batch,
                          "sample_date": sample_date, "storage_history": storage, "notes": notes,
                          "spectrum": json.dumps([round(float(x), 6) for x in spectrum]) if spectrum is not None else None,
                          "spectrum_source": source, "review_status": "none", "review_note": None,
                          "is_demo": is_demo, "created_at": db.now()})
    if spectrum is not None:
        store_predictions(sid, spectrum, bp)
    return sid


def store_predictions(sid, spectrum, bp):
    db.execute("DELETE FROM predictions WHERE sample_id=?", (sid,))
    for p in predictor.predict(spectrum, bp):
        db.insert("predictions", {"id": db.new_id(), "sample_id": sid, "target": p["target"], "value": p["value"],
                                  "error": p["error"], "model": p["model"], "r2": p["r2"], "reliable": int(p["reliable"]),
                                  "created_at": db.now()})


def seed():
    if db.one("SELECT COUNT(*) n FROM samples")["n"] > 0:
        return
    i = 0
    for j, bp in enumerate(BYPRODUCTS):
        for n in range(4):
            spec, t = simulate_scan(bp, seed=1000 + i)
            code = f"{bp[:3].upper()}-{101 + n}"
            d = (date.today() - timedelta(days=3 + i * 3)).isoformat()
            sid = create_sample(code, bp, SUPPLIERS[(j + n) % 5], f"DEMO-B{20 + i:03d}", d, STORAGE[(i + j) % 5],
                                "Seeded demo sample (synthetic).", spec, "Simulated NIR scan")
            scenario(i, sid, t, bp)
            i += 1


COST_DEMO = [
    ("DEMO-CLEAN-01", "guar_meal", 901, "Clean batch (cost demo): passes screening first time.",
     {"protein": 53, "oil": 3.5, "moisture": 8, "fibre_total": 15, "fibre_soluble": 4.5, "fibre_insoluble": 10.5, "gum": 5,
      "phytate": 14, "tannins": 3, "trypsin_inhibitor": 8},
     [("protein", 53.2, "Kjeldahl"), ("oil", 3.4, "Soxhlet"), ("fibre_total", 15.1, "AOAC enzymatic-gravimetric"), ("gum", 4.8, "Enzymatic assay"),
      ("phytate", 14.2, "Spectrophotometric"), ("tannins", 2.9, "Folin-Ciocalteu"), ("trypsin_inhibitor", 7.5, "AACC 22-40"), ("saponins", 3.0, "Gravimetric"),
      ("afb1", 1.5, "HPLC"), ("aflatoxin_total", 2.2, "HPLC"), ("apc", 18000, "Plate count"), ("yeast_mould", 150, "Plate count"),
      ("water_activity", 0.52, "Dew-point meter")],
     [("salmonella", "not_detected", "Culture"), ("e_coli", "not_detected", "PCR")]),
    ("DEMO-FIX-01", "groundnut_cake", 902, "Needs fixes (cost demo): high oil, ANFs and microbial load.",
     {"protein": 46, "oil": 10.5, "moisture": 9, "fibre_total": 12, "fibre_soluble": 1.8, "fibre_insoluble": 10.2, "gum": 0.1,
      "phytate": 23, "tannins": 5, "trypsin_inhibitor": 19},
     [("protein", 45.8, "Kjeldahl"), ("oil", 10.4, "Soxhlet"), ("phytate", 23.5, "Spectrophotometric"), ("trypsin_inhibitor", 18.6, "AACC 22-40"),
      ("tannins", 4.8, "Folin-Ciocalteu"), ("afb1", 3.2, "HPLC"), ("aflatoxin_total", 4.5, "HPLC"), ("apc", 260000, "Plate count"),
      ("yeast_mould", 3200, "Plate count"), ("water_activity", 0.70, "Dew-point meter"), ("moisture", 11.2, "Oven drying")],
     [("salmonella", "not_detected", "Culture"), ("e_coli", "not_detected", "PCR"), ("allergen_peanut", "detected", "ELISA")]),
    ("DEMO-AFLA-01", "groundnut_cake", 903, "Failed on aflatoxin (cost demo): divert or reject, human review required.",
     {"protein": 47, "oil": 8, "moisture": 8, "fibre_total": 12, "fibre_soluble": 1.8, "fibre_insoluble": 10.2, "gum": 0.1,
      "phytate": 18, "tannins": 5, "trypsin_inhibitor": 14},
     [("protein", 47.1, "Kjeldahl"), ("afb1", 24.6, "HPLC"), ("aflatoxin_total", 31.8, "HPLC"), ("apc", 90000, "Plate count"),
      ("yeast_mould", 900, "Plate count"), ("water_activity", 0.62, "Dew-point meter")],
     [("salmonella", "not_detected", "Culture"), ("e_coli", "not_detected", "Culture"), ("allergen_peanut", "detected", "ELISA")]),
]


def seed_cost_demo():
    for i, (code, bp, rs, note, t, nums, cats) in enumerate(COST_DEMO):
        if db.one("SELECT id FROM samples WHERE sample_code=?", (code,)):
            continue
        spec = spectrum_from_targets(np.random.default_rng(rs), t)
        sid = create_sample(code, bp, SUPPLIERS[i], f"DEMO-C{i + 1:02d}", (date.today() - timedelta(days=1 + i)).isoformat(),
                            STORAGE[i], note, spec, "Simulated NIR scan")
        for tg, v, m in nums:
            lab(sid, tg, v, method=m)
        for tg, res, m in cats:
            lab(sid, tg, result=res, method=m, confirmation="Confirmed" if not tg.startswith("allergen") else None)
