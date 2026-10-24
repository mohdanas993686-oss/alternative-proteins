"""Formulation blender: mass-weighted mixing of by-product profiles (DEMO DATA)."""
import db
import rules
from ml.synth import BYPRODUCTS

KEYS = ["protein", "oil", "moisture", "fibre_total", "fibre_soluble", "fibre_insoluble", "gum",
        "phytate", "tannins", "trypsin_inhibitor"]
ZERO_IF_MISSING = {"gum"}


def _values(r):
    return {c["key"]: c["value"] for c in r["composition"] + r["anf"] if c["value"] is not None}


def sources():
    reps = [rules.build_report(s["id"]) for s in db.query("SELECT id FROM samples ORDER BY sample_code")]
    out = []
    for bp, meta in BYPRODUCTS.items():
        rs = [r for r in reps if r["sample"]["byproduct"] == bp]
        if not rs:
            continue
        vals = {}
        for k in KEYS:
            xs = [_values(r)[k] for r in rs if k in _values(r)]
            if xs:
                vals[k] = round(sum(xs) / len(xs), 3)
        out.append({"id": f"type:{bp}", "kind": "byproduct", "byproduct": bp, "label": f"{meta['label']} (average)",
                    "n_samples": len(rs), "values": vals, "status": None, "allergens": list(meta["allergens"])})
    for r in reps:
        s = r["sample"]
        if not {"protein", "moisture"} <= set(_values(r)):
            continue
        detected = [rules.ALLERGENS[l["target"]] for l in r["lab_results"] if l["target"] in rules.ALLERGENS and l["result"] == "detected"]
        out.append({"id": f"sample:{s['id']}", "kind": "sample", "byproduct": s["byproduct"],
                    "label": f"{s['sample_code']} · {s['byproduct_label']}", "values": _values(r),
                    "status": r["overall_status"], "allergens": sorted(set(BYPRODUCTS[s["byproduct"]]["allergens"]) | set(detected))})
    return out


def _as_lists(vals):
    comp = [{"key": k, "value": vals.get(k)} for k in rules.COMPOSITION]
    anf = [{"key": k, "value": vals.get(k)} for k in rules.ANF]
    return comp, anf


def _status(src):
    return src["status"] or "REVIEW"


def blend(components):
    srcs = {s["id"]: s for s in sources()}
    missing = [c["source_id"] for c in components if c["source_id"] not in srcs]
    if missing:
        raise ValueError(f"Unknown source(s): {missing}")
    parts = [(srcs[c["source_id"]], c["percent"] / 100) for c in components]
    dm = [w * (1 - s["values"].get("moisture", 0) / 100) for s, w in parts]
    vals = {"moisture": round(sum(w * s["values"].get("moisture", 0) for s, w in parts), 3)}
    shares = {}
    for k in KEYS:
        if k == "moisture":
            continue
        have = [k in s["values"] or k in ZERO_IF_MISSING for s, _ in parts]
        if not any(have):
            continue
        contrib = [d * s["values"].get(k, 0) if h else 0 for (s, _), d, h in zip(parts, dm, have)]
        tot_dm = sum(d for d, h in zip(dm, have) if h)
        vals[k] = round(sum(contrib) / tot_dm, 3) if tot_dm else None
        total = sum(contrib)
        shares[k] = [round(100 * x / total, 1) if total else 0 for x in contrib]
    status = max((_status(s) for s, _ in parts), key=lambda x: rules.RANK[x])
    comp, anf = _as_lists(vals)
    score = rules.suitability(comp, anf, status)
    allergens = sorted({a for s, _ in parts for a in s["allergens"]})
    notes = ["A blend inherits the worst screening status of its components: a contaminated lot must never be diluted to meet a limit."]
    if any(s["kind"] == "byproduct" for s, _ in parts):
        notes.append("By-product averages carry no lot-level safety data: actual lots must be screened (treated as REVIEW).")
    if allergens:
        notes.append(f"Allergen declaration needed for: {', '.join(allergens)}.")
    notes.append("Values are mass-weighted on a dry-matter basis; ANF values are mostly unreliable NIR predictions, so confirm the blend by lab assay.")
    comps = []
    for (s, w), d in zip(parts, dm):
        c, a = _as_lists(s["values"])
        sc = rules.suitability(c, a, _status(s))
        comps.append({"source_id": s["id"], "label": s["label"], "kind": s["kind"], "byproduct": s["byproduct"],
                      "percent": round(w * 100, 2), "status": _status(s), "score": sc["score"], "values": s["values"],
                      "allergens": s["allergens"]})
    return {"values": vals, "composition": [{**c, "label": rules.COMPOSITION[c["key"]][0], "unit": rules.COMPOSITION[c["key"]][1]} for c in comp if c["value"] is not None],
            "anf": [{**c, "label": rules.ANF[c["key"]][0], "unit": rules.ANF[c["key"]][1]} for c in anf if c["value"] is not None],
            "status": status, "suitability": score, "allergens": allergens, "contribution_shares": shares,
            "components": comps, "notes": notes, "demo_data": True,
            "disclaimer": "Theoretical blend calculated from demo data. It is not a tested formulation and is not certified safe."}
