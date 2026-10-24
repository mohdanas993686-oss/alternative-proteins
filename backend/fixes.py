"""Fix catalogue, problem detection, conventional protein sources and editable cost assumptions.
All money values are PLACEHOLDER INR assumptions: illustrative, replace with real quotes."""
import json
from datetime import date
import db
import rules
from ml.synth import BYPRODUCTS

ALL = list(BYPRODUCTS)
STATUSES = ["Fixable", "Human review required", "Divert or reject"]
SAFETY = ("aflatoxin", "pathogen", "allergen")

PROBLEMS = {
    "microbial": {"label": "High microbial count / yeast & mould", "category": "quality", "icon": "bug",
                  "cause": "Moist or warm storage lets microbes grow (water activity above ~0.65)."},
    "high_oil": {"label": "Rancidity / high residual oil", "category": "quality", "icon": "droplet",
                 "cause": "Incomplete pressing leaves oil that oxidises and turns rancid."},
    "low_protein": {"label": "Low protein", "category": "quality", "icon": "trending-down",
                    "cause": "Hull, bran or fibre dilutes the protein fraction."},
    "high_fibre": {"label": "High fibre", "category": "quality", "icon": "wheat",
                   "cause": "Hull and cell-wall material stay with the protein."},
    "gum": {"label": "Residual guar gum", "category": "quality", "icon": "layers",
            "cause": "Galactomannan from the endosperm carried into the meal."},
    "phytate": {"label": "High phytate", "category": "anf", "icon": "atom",
                "cause": "Seed phosphorus store; binds iron, zinc and protein."},
    "trypsin": {"label": "Trypsin inhibitors / lectins", "category": "anf", "icon": "shield-off",
                "cause": "Heat-labile seed proteins not inactivated during pressing."},
    "tannins": {"label": "Tannins / saponins", "category": "anf", "icon": "leaf",
                "cause": "Seed-coat polyphenols and saponins lower digestibility."},
    "flavour": {"label": "Bitterness / beany flavour", "category": "quality", "icon": "frown",
                "cause": "Saponins, tannins and oxidised-lipid volatiles."},
    "aflatoxin": {"label": "Aflatoxin above limit", "category": "safety", "icon": "skull",
                  "cause": "Aspergillus mould growth in field or storage. No reprocessing fix."},
    "pathogen": {"label": "Pathogen detected", "category": "safety", "icon": "biohazard",
                 "cause": "Contamination during handling, storage or from the environment."},
    "allergen": {"label": "Allergen present / cross-contact", "category": "safety", "icon": "alert-triangle",
                 "cause": "Inherent allergenic proteins or shared equipment. They cannot be removed."},
}

PROCESS_ORDER = ["sieving", "milling_sieving", "separation", "air_classification", "fractionation", "defatting",
                 "wet_extraction", "soaking", "washing", "phytase", "enzymatic", "fermentation", "selective_extraction",
                 "heat", "stabilisation", "kill_step", "drying", "antioxidants", "packaging", "storage",
                 "segregate", "cleaning", "supplier", "divert"]

# problem, method, action, byproducts, cost low/typ/high (INR per kg input), protein recovery, mass yield, hours,
# equipment, retest lines, status, effectiveness %, scale-up ease, digestibility gain, effects, side stream, note
_SEED = [
    ("microbial", "drying", "Drying to below 10% moisture", ALL, 1.5, 2.5, 4, 0.99, 0.95, 8, "Tray or belt dryer", ["microbial"], "Fixable", 45, 80, 0,
     {"moisture_set": 8, "water_activity_set": 0.55, "yeast_mould": 0.5, "apc": 0.7}, "Water evaporated", "Stops growth; does not kill pathogens."),
    ("microbial", "heat", "Validated heat treatment", ALL, 3, 5, 8, 0.97, 0.97, 4, "Steam conditioner (validated time/temperature)", ["microbial"], "Human review required", 95, 65, 0.02,
     {"apc": 0.001, "yeast_mould": 0.01, "trypsin_inhibitor": 0.6}, "Moisture loss", "Process must be validated; may lower protein solubility."),
    ("microbial", "storage", "Improved storage (sealed, dry, cool)", ALL, 0.8, 1.2, 2, 1.0, 0.995, 2, "Airtight bags, pallets, humidity logger", ["microbial"], "Fixable", 20, 95, 0,
     {"yeast_mould": 0.9}, "Handling loss", "Prevents further growth only."),
    ("high_oil", "defatting", "Further defatting (solvent extraction)", ALL, 6, 9, 14, 0.98, 0.92, 6, "Solvent extraction plant + desolventiser", ["oil"], "Fixable", 85, 55, 0.01,
     {"oil": 0.15}, "Oil removed", "Residual solvent must be checked."),
    ("high_oil", "stabilisation", "Stabilisation (heat inactivates lipase)", ALL, 2, 3, 5, 0.98, 0.98, 2, "Extruder or steam stabiliser", ["oil"], "Fixable", 55, 75, 0.01,
     {"trypsin_inhibitor": 0.8}, "Moisture loss", "Slows rancidity; the oil stays in."),
    ("high_oil", "antioxidants", "Natural antioxidants (e.g. rosemary extract)", ALL, 1, 1.8, 3, 1.0, 1.0, 1, "Ribbon mixer", ["oil"], "Human review required", 35, 90, 0,
     {}, "None", "Additive must be permitted for the intended food use."),
    ("high_oil", "packaging", "Airtight / nitrogen-flushed packaging", ALL, 2, 3, 4.5, 1.0, 1.0, 1, "N2-flush packer, barrier bags", [], "Fixable", 30, 85, 0,
     {}, "None", "Slows oxidation during storage."),
    ("low_protein", "sieving", "Sieving (remove coarse hull/fibre)", ALL, 0.8, 1.5, 2.5, 0.85, 0.7, 3, "Vibro sieve", ["protein"], "Fixable", 20, 90, 0,
     {"fibre_total": 0.75, "fibre_insoluble": 0.7, "phytate": 0.95}, "Coarse hull fraction", ""),
    ("low_protein", "air_classification", "Air classification (protein-rich fines)", ALL, 4, 6, 9, 0.7, 0.45, 4, "Fine mill + air classifier", ["protein"], "Fixable", 40, 60, 0.02,
     {"fibre_total": 0.5, "fibre_insoluble": 0.45, "oil": 0.9}, "Coarse fibre/starch fraction", ""),
    ("low_protein", "wet_extraction", "Wet extraction to protein concentrate", ALL, 35, 55, 85, 0.6, 0.22, 24, "Extraction tanks, decanter, spray dryer", ["protein", "microbial", "anf"], "Human review required", 80, 35, 0.12,
     {"fibre_total": 0.1, "fibre_insoluble": 0.08, "fibre_soluble": 0.3, "oil": 0.3, "phytate": 0.4, "tannins": 0.3, "gum": 0.2, "trypsin_inhibitor": 0.6},
     "Fibre residue + process water", "New process: needs validation and regulatory review."),
    ("high_fibre", "milling_sieving", "Milling + sieving / air classification", ALL, 3, 5, 8, 0.8, 0.62, 5, "Pin mill + sieve or air classifier", ["fibre", "protein"], "Fixable", 50, 70, 0.01,
     {"fibre_total": 0.5, "fibre_insoluble": 0.45}, "Coarse fibre fraction", ""),
    ("high_fibre", "enzymatic", "Enzymatic treatment (cellulase / xylanase)", ALL, 6, 10, 16, 0.95, 0.88, 12, "Stirred reactor + dryer", ["fibre", "microbial"], "Human review required", 40, 50, 0.03,
     {"fibre_total": 0.6, "fibre_insoluble": 0.55}, "Solubilised sugars", "Enzymes must be food-grade and permitted."),
    ("gum", "enzymatic", "Enzymatic treatment (mannanase)", ["guar_meal"], 5, 8, 12, 0.95, 0.9, 10, "Stirred reactor + dryer", ["fibre", "microbial"], "Human review required", 80, 50, 0.02,
     {"gum": 0.2, "fibre_soluble": 0.5}, "Hydrolysed gum", ""),
    ("gum", "washing", "Washing (hot water)", ["guar_meal"], 2.5, 4, 6, 0.88, 0.8, 6, "Wash tanks, dewatering screw, dryer", ["fibre", "microbial"], "Fixable", 55, 70, 0,
     {"gum": 0.45, "tannins": 0.8}, "Wash-water solids", "Wet step: dry and retest microbes afterwards."),
    ("gum", "separation", "Selective separation (sieve out gum-rich fines)", ["guar_meal"], 3, 4.5, 7, 0.85, 0.72, 4, "Sieve + air classifier", ["fibre", "protein"], "Fixable", 50, 75, 0,
     {"gum": 0.5, "fibre_total": 0.85}, "Gum-rich fraction", ""),
    ("phytate", "phytase", "Phytase treatment", ALL, 3, 5, 8, 0.98, 0.95, 8, "Stirred reactor + dryer", ["anf", "microbial"], "Fixable", 75, 65, 0.04,
     {"phytate": 0.25}, "Moisture loss", "Food-grade enzyme; confirm with a phytate assay."),
    ("phytate", "fermentation", "Controlled fermentation", ALL, 4, 6, 10, 0.93, 0.9, 36, "Fermenter, starter culture, dryer", ["anf", "microbial"], "Human review required", 65, 45, 0.05,
     {"phytate": 0.35, "tannins": 0.6, "trypsin_inhibitor": 0.6}, "CO2 and moisture", "Starter culture and microbial safety must be validated."),
    ("trypsin", "heat", "Validated moist-heat treatment / extrusion", ALL, 3, 5, 8, 0.96, 0.97, 2, "Extruder or steam cooker", ["anf"], "Fixable", 80, 70, 0.06,
     {"trypsin_inhibitor": 0.2, "apc": 0.05}, "Moisture loss", "May reduce protein solubility."),
    ("tannins", "washing", "Washing", ALL, 2, 3.5, 5, 0.9, 0.85, 6, "Wash tanks, dryer", ["anf", "microbial"], "Fixable", 50, 75, 0.02,
     {"tannins": 0.5}, "Wash-water solids", ""),
    ("tannins", "soaking", "Soaking + dehulling", ALL, 1.5, 2.5, 4, 0.94, 0.88, 16, "Soak tanks, dehuller, dryer", ["anf", "microbial"], "Fixable", 35, 80, 0.02,
     {"tannins": 0.65, "phytate": 0.85}, "Hulls + soak water", ""),
    ("tannins", "selective_extraction", "Selective extraction (aqueous ethanol)", ALL, 8, 12, 18, 0.92, 0.85, 10, "Extractor + solvent recovery", ["anf"], "Human review required", 80, 45, 0.03,
     {"tannins": 0.2, "oil": 0.7}, "Polyphenol/saponin extract", "Solvent residues must be checked."),
    ("flavour", "fractionation", "Fractionation (air classification)", ALL, 4, 6, 9, 0.75, 0.55, 4, "Air classifier", ["protein"], "Fixable", 40, 60, 0,
     {"fibre_total": 0.6}, "Coarse fraction", "Confirm with a sensory panel."),
    ("flavour", "washing", "Washing", ALL, 2, 3.5, 5, 0.9, 0.85, 6, "Wash tanks, dryer", ["microbial"], "Fixable", 35, 75, 0,
     {"tannins": 0.7}, "Wash-water solids", "Confirm with a sensory panel."),
    ("flavour", "fermentation", "Fermentation", ALL, 4, 6, 10, 0.93, 0.9, 36, "Fermenter, dryer", ["microbial", "anf"], "Human review required", 60, 45, 0.04,
     {"phytate": 0.5}, "CO2 and moisture", "Microbial validation required."),
    ("aflatoxin", "divert", "Divert or reject (no reprocessing fix)", ALL, 2, 3, 5, 0, 0, 24, "Segregated quarantine store", [], "Divert or reject", None, 100, 0,
     {}, "Rejected / diverted material", "No reprocessing fix. Human review required. Divert only to permitted non-food uses."),
    ("pathogen", "divert", "Reject or divert", ALL, 2, 3, 5, 0, 0, 24, "Quarantine + documented disposal", [], "Divert or reject", None, 100, 0,
     {}, "Rejected material", "Human review required."),
    ("pathogen", "kill_step", "Validated kill step + independent retest (only if your food-safety plan allows)", ALL, 3, 6, 10, 0.96, 0.97, 6,
     "Validated kill step, HACCP verification", ["microbial"], "Human review required", None, 55, 0,
     {"apc": 0.001, "yeast_mould": 0.01}, "Moisture loss", "Only if your food-safety plan allows. Retest on a new independent sample; a human reviewer decides."),
    ("allergen", "segregate", "Segregate and relabel (declare allergen)", ALL, 0.5, 1, 2, 1.0, 1.0, 4, "Segregated storage, label review", ["allergen"], "Human review required", None, 90, 0,
     {}, "None", "Allergenic proteins cannot be removed from the material."),
    ("allergen", "supplier", "Change supplier / dedicated line", ALL, 1, 3, 6, 1.0, 1.0, 336, "Supplier audit, supply-chain verification", ["allergen"], "Human review required", None, 50, 0,
     {}, "None", "Price premium for a dedicated supply."),
    ("allergen", "cleaning", "Clean and validate equipment", ALL, 0.5, 1.2, 2.5, 1.0, 1.0, 8, "Cleaning validation swabs (ELISA)", ["allergen"], "Human review required", None, 80, 0,
     {}, "None", "Reduces cross-contact only; inherent allergens remain."),
]
FIELDS = ("problem", "method", "action", "byproducts", "cost_low", "cost_typical", "cost_high", "protein_recovery", "mass_yield",
          "time_h", "equipment", "retest", "status", "effectiveness", "scale_ease", "digestibility_gain", "effects", "side_stream", "note")
JSON_FIELDS = ("byproducts", "retest", "effects")

CONVENTIONAL = [
    ("spi", "Soy protein isolate", 300, 350, 420, 90, 0.95, "PDCAAS ~0.95", 3, "Soy (major allergen)", 70, 90, 95),
    ("spc", "Soy protein concentrate", 150, 180, 220, 68, 0.92, "PDCAAS ~0.9", 3, "Soy (major allergen)", 65, 90, 95),
    ("tsp", "Defatted soy flour / textured soy protein", 60, 78, 95, 50, 0.88, "PDCAAS ~0.9", 3, "Soy (major allergen)", 60, 90, 95),
    ("wpc", "Whey protein concentrate (WPC80)", 900, 1100, 1400, 78, 1.0, "PDCAAS 1.0 / DIAAS ~1.0", 3, "Milk (major allergen)", 85, 85, 100),
    ("ppi", "Pea protein isolate", 380, 450, 550, 82, 0.82, "PDCAAS ~0.8", 1, "Pea (lower risk)", 60, 80, 90),
    ("dal", "Pulses (whole dal, reference)", 90, 110, 140, 22, 0.75, "PDCAAS ~0.7-0.8", 1, "Pulse", 80, 85, 100),
]
CONV_FIELDS = ("key", "name", "price_low", "price_typical", "price_high", "protein_pct", "digestibility", "quality_basis",
               "allergen_risk", "allergen_note", "flavour", "supply", "regulatory", "price_source", "price_date", "assumption")

DEFAULT_ASSUMPTIONS = {
    "fx_per_inr": {"INR": 1.0, "USD": 0.012, "EUR": 0.011},
    "batch_kg": 1000, "scale": "auto", "scale_multipliers": {"lab": 2.5, "pilot": 1.5, "industrial": 1.0},
    "raw_price": {"guar_meal": {"low": 32, "typical": 40, "high": 50}, "groundnut_cake": {"low": 38, "typical": 46, "high": 56},
                  "almond_cake": {"low": 55, "typical": 70, "high": 90}, "rice_bran": {"low": 14, "typical": 18, "high": 24},
                  "pulse_residue": {"low": 18, "typical": 24, "high": 32}},
    "digestibility": {"guar_meal": 0.70, "groundnut_cake": 0.76, "almond_cake": 0.72, "rice_bran": 0.66, "pulse_residue": 0.72},
    "testing": {"protein": 800, "oil": 700, "fibre": 1500, "aflatoxin": 2500, "microbial": 3500, "allergen": 4500, "anf": 4000},
    "lab_turnaround_h": {"protein": 24, "oil": 24, "fibre": 72, "aflatoxin": 48, "microbial": 72, "allergen": 48, "anf": 96},
    "labour_per_kg": 3.0, "energy_per_kg": 2.0, "packaging_per_kg": 2.5, "transport_per_kg": 1.5, "overhead_pct": 12,
    "failure_prob": 0.15, "diversion_value_per_kg": 6.0, "review_h": 24,
    "quality_targets": {"protein": 40, "oil": 6, "fibre_total": 18, "gum": 6, "phytate": 20, "tannins": 6, "trypsin_inhibitor": 12},
    "byproduct_criteria": {"guar_meal": {"allergen_risk": 0, "flavour": 45, "supply": 60, "regulatory": 30},
                           "groundnut_cake": {"allergen_risk": 3, "flavour": 65, "supply": 75, "regulatory": 45},
                           "almond_cake": {"allergen_risk": 3, "flavour": 70, "supply": 40, "regulatory": 40},
                           "rice_bran": {"allergen_risk": 0, "flavour": 50, "supply": 80, "regulatory": 50},
                           "pulse_residue": {"allergen_risk": 1, "flavour": 45, "supply": 65, "regulatory": 55}},
}
TEST_LINES = list(DEFAULT_ASSUMPTIONS["testing"])


# ---------------- storage ----------------
def _row_out(r):
    for k in JSON_FIELDS:
        r[k] = json.loads(r[k]) if r.get(k) else ([] if k != "effects" else {})
    r["protein_loss_pct"] = round((1 - (r["protein_recovery"] or 0)) * 100, 1)
    r["problem_label"] = PROBLEMS.get(r["problem"], {}).get("label", r["problem"])
    return r


def _row_in(d):
    return {k: (json.dumps(d[k]) if k in JSON_FIELDS else d[k]) for k in FIELDS if k in d}


def seed():
    if db.one("SELECT COUNT(*) n FROM fix_catalogue")["n"] == 0:
        for i, t in enumerate(_SEED, 1):
            row = _row_in(dict(zip(FIELDS, t)))
            db.insert("fix_catalogue", {"id": f"fx{i:02d}", **row, "created_at": db.now(), "updated_at": db.now()})
    if db.one("SELECT COUNT(*) n FROM conventional_sources")["n"] == 0:
        for t in CONVENTIONAL:
            d = dict(zip(CONV_FIELDS, list(t) + ["PLACEHOLDER (no real quote)", date.today().isoformat(), "Assumption: verify"]))
            db.insert("conventional_sources", {"id": db.new_id(), **d, "placeholder": 1, "created_at": db.now(), "updated_at": db.now()})


def catalogue():
    return [_row_out(r) for r in db.query("SELECT * FROM fix_catalogue ORDER BY id")]


def catalogue_map():
    return {f["id"]: f for f in catalogue()}


def get_fix(fid):
    r = db.one("SELECT * FROM fix_catalogue WHERE id=?", (fid,))
    return _row_out(r) if r else None


def save_fix(d, fid=None):
    row = _row_in(d)
    if fid:
        sets = ",".join(f"{k}=?" for k in row)
        db.execute(f"UPDATE fix_catalogue SET {sets}, updated_at=? WHERE id=?", (*row.values(), db.now(), fid))
        return get_fix(fid)
    fid = f"fx{db.new_id()}"
    db.insert("fix_catalogue", {"id": fid, **row, "created_at": db.now(), "updated_at": db.now()})
    return get_fix(fid)


def conventional():
    return db.query("SELECT * FROM conventional_sources ORDER BY price_typical")


def assumptions():
    row = db.one("SELECT value FROM settings WHERE key='cost_assumptions'")
    out = json.loads(json.dumps(DEFAULT_ASSUMPTIONS))
    for k, v in (json.loads(row["value"]) if row else {}).items():
        out[k] = {**out[k], **v} if isinstance(out.get(k), dict) and isinstance(v, dict) else v
    return out


def save_assumptions(a):
    db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('cost_assumptions', ?)", (json.dumps(a),))


# ---------------- problem detection ----------------
def _p(key, status, msg, value=None, target=None, unit=None):
    p = PROBLEMS[key]
    return {"problem": key, "label": p["label"], "category": p["category"], "icon": p["icon"], "cause": p["cause"],
            "status": status, "message": msg, "value": value, "target": target, "unit": unit}


def detect(bp, v, flags=None, a=None):
    a, th, out = a or assumptions(), rules.thresholds(), []
    t = a["quality_targets"]
    micro = [(k, v[k], th[k]) for k in ("apc", "yeast_mould", "water_activity", "moisture") if v.get(k) is not None and v[k] > th[k]["review"]]
    if micro:
        st = "FAIL" if any(x > lim["fail"] for _, x, lim in micro) else "REVIEW"
        out.append(_p("microbial", st, "Above placeholder review limit: " + ", ".join(k.replace("_", " ") for k, _, _ in micro)))
    unit = lambda k: (rules.COMPOSITION.get(k) or rules.ANF.get(k))[1]
    for key, prob, cmp in (("oil", "high_oil", ">"), ("protein", "low_protein", "<"), ("fibre_total", "high_fibre", ">"), ("gum", "gum", ">"),
                           ("phytate", "phytate", ">"), ("trypsin_inhibitor", "trypsin", ">"), ("tannins", "tannins", ">")):
        x = v.get(key)
        if x is None:
            continue
        if (cmp == ">" and x > t[key]) or (cmp == "<" and x < t[key]):
            out.append(_p(prob, "REVIEW", f"{x:.1f} {unit(key)} (placeholder target {'≥' if cmp == '<' else '≤'} {t[key]})", round(x, 2), t[key], unit(key)))
    if bp in ("guar_meal", "pulse_residue") and ((v.get("tannins") or 0) > 5 or (v.get("saponins") or 0) > 5):
        out.append(_p("flavour", "REVIEW", "Bitter/beany compounds likely: sensory check recommended."))
    flags = flags or []
    afl = [f for f in flags if f["category"] == "Aflatoxin" and f["status"] in ("FAIL", "RETEST") and f.get("limit") is not None
           and v.get(f["key"]) is not None and v[f["key"]] > f["limit"]]
    if afl:
        out.append(_p("aflatoxin", max((f["status"] for f in afl), key=lambda s: rules.RANK[s]),
                      "Above placeholder limit: " + ", ".join(f"{f['label']} {f['value']}" for f in afl)))
    elif not flags and (v.get("afb1") or 0) > th["afb1"]["limit"]:
        out.append(_p("aflatoxin", "FAIL", f"Typical AFB1 {v['afb1']:.1f} µg/kg above placeholder limit."))
    pat = [f for f in flags if f["category"] == "Microbial safety" and (f.get("value") or "").startswith("detected")]
    if pat:
        out.append(_p("pathogen", max((f["status"] for f in pat), key=lambda s: rules.RANK[s]),
                      ", ".join(f"{f['label']}: {f['message']}" for f in pat)))
    alg = list(BYPRODUCTS[bp]["allergens"]) + [f["label"] for f in flags if f["category"] == "Allergens" and f.get("value") == "detected"]
    if alg:
        out.append(_p("allergen", "REVIEW", "Declare / control: " + ", ".join(dict.fromkeys(alg))))
    return out


def applicable(f, bp):
    return bp in f["byproducts"]


def options(bp, problems, cat=None):
    cat = cat or catalogue()
    return {p["problem"]: [f for f in cat if f["problem"] == p["problem"] and applicable(f, bp)] for p in problems}


def order(fix_list):
    return sorted(fix_list, key=lambda f: PROCESS_ORDER.index(f["method"]) if f["method"] in PROCESS_ORDER else 99)


def recommended(bp, problems, cat=None):
    cat, chosen = cat or catalogue(), {}
    for p in problems:
        if p["category"] == "safety" or p["problem"] == "flavour":
            continue
        cands = [f for f in cat if f["problem"] == p["problem"] and f["status"] == "Fixable" and applicable(f, bp)]
        if not cands:
            continue
        best = max(cands, key=lambda f: (f["effectiveness"] or 0) / max(f["cost_typical"], 0.5))
        if best["method"] not in {c["method"] for c in chosen.values()}:
            chosen[best["id"]] = best
    return order(list(chosen.values()))
