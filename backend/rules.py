"""Target catalogue, rule engine, scoring and report building. Thresholds are PLACEHOLDERS."""
import json
import db
from ml.synth import BYPRODUCTS
from ml import predictor

COMPOSITION = {
    "protein": ("Crude protein", "% DM"), "oil": ("Residual oil", "% DM"), "moisture": ("Moisture", "%"),
    "fibre_total": ("Total dietary fibre", "% DM"), "fibre_soluble": ("Soluble dietary fibre", "% DM"),
    "fibre_insoluble": ("Insoluble dietary fibre", "% DM"), "gum": ("Residual gum", "% DM"),
}
ANF = {
    "phytate": ("Phytate", "mg/g"), "tannins": ("Tannins", "mg/g"),
    "trypsin_inhibitor": ("Trypsin-inhibitor activity", "TIU/mg"),
    "lectins": ("Lectins (optional)", "HU/mg"), "saponins": ("Saponins (optional)", "mg/g"),
}
SAFETY_NUMERIC = {
    "afb1": ("Aflatoxin B1", "µg/kg"), "aflatoxin_total": ("Total aflatoxins", "µg/kg"),
    "apc": ("Aerobic plate count", "cfu/g"), "yeast_mould": ("Yeast & mould", "cfu/g"),
    "water_activity": ("Water activity", "aw"),
}
PATHOGENS = {"salmonella": "Salmonella spp.", "e_coli": "E. coli", "listeria": "Listeria monocytogenes"}
ALLERGENS = {"allergen_peanut": "peanut", "allergen_almond": "almond", "allergen_pulse": "pulse"}
NOTES = {"cross_contact": "Cross-contact notes", "supplier_notes": "Supplier notes"}

DEFAULT_THRESHOLDS = {
    "afb1": {"limit": 10, "unit": "µg/kg"},
    "aflatoxin_total": {"limit": 15, "unit": "µg/kg"},
    "apc": {"review": 100000, "fail": 1000000, "unit": "cfu/g"},
    "yeast_mould": {"review": 1000, "fail": 10000, "unit": "cfu/g"},
    "water_activity": {"review": 0.65, "fail": 0.75, "unit": "aw"},
    "moisture": {"review": 12, "fail": 14, "unit": "%"},
}
RANK = {"PASS": 0, "REVIEW": 1, "RETEST": 2, "FAIL": 3}
MULT = {"PASS": 1.0, "REVIEW": 0.85, "RETEST": 0.6, "FAIL": 0.0}


def thresholds():
    row = db.one("SELECT value FROM settings WHERE key='thresholds'")
    return {**DEFAULT_THRESHOLDS, **(json.loads(row["value"]) if row else {})}


def save_thresholds(t):
    db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('thresholds', ?)", (json.dumps(t),))


def latest_labs(sample_id):
    rows = db.query("SELECT * FROM lab_results WHERE sample_id=? ORDER BY created_at", (sample_id,))
    return {r["target"]: r for r in rows}


def latest_preds(sample_id):
    rows = db.query("SELECT * FROM predictions WHERE sample_id=? ORDER BY created_at", (sample_id,))
    return {r["target"]: r for r in rows}


def _flag(key, label, category, status, message, value=None, method=None, limit=None):
    return {"key": key, "label": label, "category": category, "status": status, "message": message,
            "value": value, "method": method, "limit": limit}


def _fmt(v):
    return f"{v:,.0f}" if abs(v) >= 100 else f"{v:g}"


def evaluate_safety(sample, labs, preds):
    th, flags = thresholds(), []
    for key in ("afb1", "aflatoxin_total"):
        label, unit = SAFETY_NUMERIC[key]
        lim, r = th[key]["limit"], labs.get(key)
        if not r or r["value"] is None:
            flags.append(_flag(key, label, "Aflatoxin", "RETEST", "No result entered: aflatoxin test required.", limit=lim))
            continue
        v, m = r["value"], r["method"] or "unspecified method"
        screening = "hplc" not in m.lower()
        if v > lim:
            st, msg = ("RETEST", f"Screening result above placeholder limit ({lim} {unit}). Confirm by HPLC.") if screening \
                else ("FAIL", f"Above placeholder limit ({lim} {unit}) by HPLC.")
        elif v > 0.5 * lim:
            st, msg = ("RETEST", "Close to limit on a screening test. Confirm by HPLC.") if screening \
                else ("REVIEW", "Within limit but above 50% of it. Reviewer should assess.")
        else:
            st = "PASS"
            msg = "Not detected by this test." if v == 0 else f"Below placeholder limit by this test ({m})."
        flags.append(_flag(key, label, "Aflatoxin", st, msg, f"{_fmt(v)} {unit}", m, lim))
    if labs.get("afb1") and labs.get("aflatoxin_total") and labs["afb1"]["value"] is not None \
            and labs["aflatoxin_total"]["value"] is not None and labs["afb1"]["value"] > labs["aflatoxin_total"]["value"]:
        flags.append(_flag("aflatoxin_consistency", "Aflatoxin entries", "Aflatoxin", "RETEST",
                           "Inconsistent entry: AFB1 is higher than total aflatoxins. Re-check lab report."))
    for key in ("apc", "yeast_mould", "water_activity"):
        label, unit = SAFETY_NUMERIC[key]
        t, r = th[key], labs.get(key)
        if not r or r["value"] is None:
            flags.append(_flag(key, label, "Microbial quality", "RETEST", "No result entered: test required.", limit=t["review"]))
            continue
        v = r["value"]
        st = "FAIL" if v > t["fail"] else "REVIEW" if v > t["review"] else "PASS"
        msg = {"FAIL": f"Above placeholder fail limit ({_fmt(t['fail'])} {unit}).",
               "REVIEW": f"Above placeholder review limit ({_fmt(t['review'])} {unit}).",
               "PASS": "Within placeholder limit by this test."}[st]
        flags.append(_flag(key, label, "Microbial quality", st, msg, f"{_fmt(v)} {unit}", r["method"], t["review"]))
    lab_m, pred_m = labs.get("moisture"), preds.get("moisture")
    mv = lab_m["value"] if lab_m and lab_m["value"] is not None else (pred_m["value"] if pred_m else None)
    if mv is not None:
        t = th["moisture"]
        st = "FAIL" if mv > t["fail"] else "REVIEW" if mv > t["review"] else "PASS"
        src = "lab" if lab_m else "NIR prediction"
        if st == "FAIL" and not lab_m:
            st = "RETEST"
        flags.append(_flag("moisture", "Moisture", "Microbial quality", st,
                           f"Moisture {mv:.1f}% ({src}); placeholder review > {t['review']}%, fail > {t['fail']}%.",
                           f"{mv:.1f} %", src, t["review"]))
    aw = labs.get("water_activity")
    if aw and aw["value"] is not None and mv is not None and aw["value"] > 0.75 and mv < 8:
        flags.append(_flag("aw_consistency", "Water activity vs moisture", "Microbial quality", "RETEST",
                           "Inconsistent: high water activity with low moisture. Re-check entries."))
    for key, label in PATHOGENS.items():
        r = labs.get(key)
        if not r or not r["result"]:
            if key == "listeria":
                continue
            flags.append(_flag(key, label, "Microbial safety", "RETEST", "Not yet tested: pathogen test required."))
            continue
        m, conf = r["method"] or "unspecified method", (r["confirmation"] or "pending").lower()
        if r["result"] == "detected":
            st, msg = ("FAIL", "Detected and confirmed. Escalate to human reviewer.") if conf == "confirmed" \
                else ("RETEST", f"Presumptive detection ({conf}). Confirmatory testing required.")
        elif r["result"] == "inconclusive":
            st, msg = "RETEST", "Inconclusive result. Repeat test."
        else:
            st = "PASS" if conf == "confirmed" else "REVIEW"
            msg = f"Not detected by this test ({m})." + ("" if conf == "confirmed" else " Confirmation pending.")
        flags.append(_flag(key, label, "Microbial safety", st, msg, r["result"].replace("_", " "), f"{m} / {conf}"))
    inherent = BYPRODUCTS[sample["byproduct"]]["allergens"]
    for key, name in ALLERGENS.items():
        r, label = labs.get(key), f"{name.title()} allergen"
        if name in inherent:
            flags.append(_flag(key, label, "Allergens", "REVIEW",
                               f"Inherent {name} allergen for this by-product: must be declared on labelling.",
                               r["result"].replace("_", " ") if r and r["result"] else "inherent", r["method"] if r else None))
        elif r and r["result"] == "detected":
            flags.append(_flag(key, label, "Allergens", "REVIEW", f"{name.title()} protein detected: cross-contact risk.",
                               "detected", r["method"]))
        elif r and r["result"] == "not_detected":
            flags.append(_flag(key, label, "Allergens", "PASS", f"Not detected by this test ({r['method'] or 'method n/a'}).",
                               "not detected", r["method"]))
    overall = max((f["status"] for f in flags), key=lambda s: RANK[s], default="RETEST")
    return flags, overall


def composition_view(preds, labs, keys):
    out = []
    for k, (label, unit) in keys.items():
        p, l = preds.get(k), labs.get(k)
        item = {"key": k, "label": label, "unit": unit, "predicted": None, "error": None, "model": None,
                "reliable": None, "lab": None, "lab_method": None}
        if p:
            item.update(predicted=p["value"], error=p["error"], model=p["model"], reliable=bool(p["reliable"]), r2=p["r2"])
        if l and l["value"] is not None:
            item.update(lab=l["value"], lab_method=l["method"])
        item["value"] = item["lab"] if item["lab"] is not None else item["predicted"]
        item["source"] = "Lab measured" if item["lab"] is not None else ("AI prediction" if p else None)
        if k in ANF and item["lab"] is None:
            item["lab_assay_recommended"] = not item["reliable"]
        if item["value"] is not None or k not in ("gum", "lectins", "saponins"):
            out.append(item)
    return out


def _clamp(x):
    return max(0.0, min(100.0, x))


def suitability(comp, anf, overall):
    v = {c["key"]: c["value"] for c in comp + anf}
    protein, oil = v.get("protein") or 0, v.get("oil") or 0
    fibre, moisture = v.get("fibre_total") or 0, v.get("moisture") or 0
    ps = _clamp(protein / 55 * 100)
    fs = _clamp(100 - (fibre - 5) * 2.5)
    os_ = _clamp(100 - (oil - 1) * 5)
    pen = [_clamp((v.get("phytate") or 0) / 70 * 100), _clamp((v.get("tannins") or 0) / 15 * 100),
           _clamp((v.get("trypsin_inhibitor") or 0) / 25 * 100)]
    anf_s = 100 - sum(pen) / 3
    base = 0.45 * ps + 0.15 * fs + 0.10 * os_ + 0.30 * anf_s
    mult = MULT[overall]
    usable = protein * 10 * (1 - moisture / 100) * mult
    return {
        "score": round(base * mult, 1), "base_score": round(base, 1), "safety_multiplier": mult,
        "usable_protein_g_per_kg": round(usable, 1),
        "components": [
            {"name": "Protein", "weight": 0.45, "score": round(ps, 1), "rule": "protein % DM / 55 x 100"},
            {"name": "Fibre (lower is better)", "weight": 0.15, "score": round(fs, 1), "rule": "100 - (fibre - 5) x 2.5"},
            {"name": "Residual oil (lower is better)", "weight": 0.10, "score": round(os_, 1), "rule": "100 - (oil - 1) x 5"},
            {"name": "ANF load (lower is better)", "weight": 0.30, "score": round(anf_s, 1),
             "rule": "100 - mean(phytate/70, tannins/15, TIA/25) x 100"},
        ],
        "explanation": ("Weighted score = 45% protein + 15% fibre + 10% oil + 30% anti-nutrient load, then multiplied by a "
                        "safety factor (PASS 1.0, REVIEW 0.85, RETEST 0.6, FAIL 0). Usable protein (safety-adjusted) = protein (% DM) x 10 x "
                        "(1 - moisture/100) x safety factor, in g per kg as-is. The score ranks suitability for further "
                        "evaluation only; it is not a safety or regulatory decision."),
    }


def missing_data(sample, labs, preds):
    miss = []
    if not sample.get("spectrum"):
        miss.append({"target": "spectrum", "label": "NIR spectrum", "why": "Needed for AI composition predictions."})
    for k in ("protein",):
        if k not in labs:
            miss.append({"target": k, "label": "Crude protein (Kjeldahl)", "why": "Reference value to verify NIR prediction."})
    for k in ("phytate", "tannins", "trypsin_inhibitor"):
        if k not in labs:
            miss.append({"target": k, "label": ANF[k][0], "why": "NIR prediction is unreliable for this target; lab assay recommended."})
    for k in ("afb1", "aflatoxin_total", "apc", "yeast_mould", "water_activity"):
        if k not in labs:
            miss.append({"target": k, "label": SAFETY_NUMERIC[k][0], "why": "Required for safety screening."})
    for k in ("salmonella", "e_coli"):
        if k not in labs:
            miss.append({"target": k, "label": PATHOGENS[k], "why": "Pathogen test required."})
    for k, name in ALLERGENS.items():
        if k not in labs and name not in BYPRODUCTS[sample["byproduct"]]["allergens"]:
            miss.append({"target": k, "label": f"{name.title()} allergen test", "why": "Cross-contact check."})
    return miss


def anomalies(sample, preds, labs):
    out, p = [], BYPRODUCTS[sample["byproduct"]]
    for k in ("protein", "oil", "moisture", "fibre_total"):
        pr = preds.get(k)
        rng = p.get(k)
        if pr and rng:
            lo, hi = rng
            margin = (hi - lo) * 0.25
            if pr["value"] < lo - margin or pr["value"] > hi + margin:
                out.append({"type": "out_of_range", "target": k,
                            "message": f"Predicted {COMPOSITION[k][0].lower()} {pr['value']:.1f} is outside the usual range "
                                       f"{lo}-{hi} for {p['label']}. Check sample identity or rescan."})
        lb = labs.get(k)
        if pr and lb and lb["value"] is not None and pr["error"] and abs(pr["value"] - lb["value"]) > 3 * pr["error"]:
            out.append({"type": "lab_vs_nir", "target": k,
                        "message": f"Lab {COMPOSITION[k][0].lower()} ({lb['value']:.1f}) differs from NIR prediction "
                                   f"({pr['value']:.1f}) by more than 3x model error. Repeat lab test or rescan."})
    return out


def retests(flags, anoms, comp_anf):
    out = []
    for f in flags:
        if f["status"] in ("RETEST", "FAIL", "REVIEW") and f["category"] != "Allergens":
            out.append({"test": f["label"], "status": f["status"], "reason": f["message"]})
    for a in anoms:
        out.append({"test": a["target"], "status": "RETEST", "reason": a["message"]})
    for c in comp_anf:
        if c.get("lab_assay_recommended"):
            out.append({"test": c["label"], "status": "REVIEW", "reason": "Lab assay recommended: NIR prediction is unreliable for this target."})
    return out


def sample_public(s):
    d = {k: v for k, v in s.items() if k != "spectrum"}
    d["byproduct_label"] = BYPRODUCTS[s["byproduct"]]["label"]
    d["has_spectrum"] = bool(s.get("spectrum"))
    return d


def build_report(sample_id):
    s = db.one("SELECT * FROM samples WHERE id=?", (sample_id,))
    if not s:
        return None
    labs, preds = latest_labs(sample_id), latest_preds(sample_id)
    comp, anf = composition_view(preds, labs, COMPOSITION), composition_view(preds, labs, ANF)
    flags, overall = evaluate_safety(s, labs, preds)
    anoms = anomalies(s, preds, labs)
    score = suitability(comp, anf, overall)
    lab_list = list(labs.values())
    escalate = overall != "PASS" or any(f["status"] != "PASS" for f in flags if f["category"] == "Microbial safety")
    return {
        "sample": sample_public(s), "spectrum": json.loads(s["spectrum"]) if s["spectrum"] else None,
        "wavelengths": [float(w) for w in predictor.WAVELENGTHS],
        "composition": comp, "anf": anf, "safety_flags": flags, "overall_status": overall,
        "allergen_notes": {k: labs[k]["notes"] for k in NOTES if k in labs},
        "inherent_allergens": BYPRODUCTS[s["byproduct"]]["allergens"],
        "anomalies": anoms, "retests": retests(flags, anoms, anf), "missing": missing_data(s, labs, preds),
        "suitability": score, "lab_results": lab_list, "human_review_required": escalate,
        "demo_data": True,
        "disclaimer": "This tool does not certify food safety. Confirmed results from an accredited laboratory are required.",
    }
