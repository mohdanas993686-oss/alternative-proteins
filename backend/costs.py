"""Cost engine: mass balance, cost model, scenarios, sensitivity, Monte Carlo and conventional comparison.
All prices are editable PLACEHOLDER INR assumptions (illustrative, replace with real quotes)."""
import math
import random
import statistics
import db
import rules
import fixes as fx
from ml.synth import BYPRODUCTS

SERVING_KG = 0.025
NUMERIC_LAB = ("apc", "yeast_mould", "water_activity", "afb1", "aflatoxin_total", "lectins", "saponins")
HANDLING = {"id": "handling", "method": "handling", "action": "Milling, packing & handling", "mass_yield": 0.98,
            "protein_recovery": 0.98, "cost_low": 0, "cost_typical": 0, "cost_high": 0, "effects": {}, "retest": [],
            "side_stream": "Handling loss", "time_h": 4, "digestibility_gain": 0, "status": "Fixable"}
GROUP = {"raw": "Raw material", "fix": "Processing", "labour": "Processing", "energy": "Processing", "packaging": "Processing",
         "transport": "Processing", "testing": "Testing", "retest": "Testing", "overhead": "Overhead",
         "disposal": "Disposal / diversion", "credit": "Diversion credit"}
CAVEAT = ("Cost is only one factor. Protein quality (amino-acid profile, digestibility), taste, allergen status, regulatory "
          "approval for human food and supply consistency also differ. All prices are editable assumptions, not market data.")


# ---------------- profiles ----------------
def profile_from_report(r, a=None):
    v = {c["key"]: c["value"] for c in r["composition"] + r["anf"] if c["value"] is not None}
    for l in r["lab_results"]:
        if l["target"] in NUMERIC_LAB and l["value"] is not None:
            v[l["target"]] = l["value"]
    s, bp = r["sample"], r["sample"]["byproduct"]
    probs = fx.detect(bp, v, r["safety_flags"], a)
    return {"kind": "sample", "id": s["id"], "label": f"{s['sample_code']} · {s['byproduct_label']}", "byproduct": bp,
            "values": v, "problems": probs, "overall_status": r["overall_status"],
            "safety_block": any(p["problem"] in ("aflatoxin", "pathogen") for p in probs)}


def all_reports():
    return [rules.build_report(s["id"]) for s in db.query("SELECT id FROM samples")]


def type_profile(bp, reps, a=None):
    rs = [r for r in reps if r["sample"]["byproduct"] == bp]
    if not rs:
        return None
    v = {}
    for k in list(rules.COMPOSITION) + list(rules.ANF):
        xs = [c["value"] for r in rs for c in r["composition"] + r["anf"] if c["key"] == k and c["value"] is not None]
        if xs:
            v[k] = round(sum(xs) / len(xs), 3)
    for k in NUMERIC_LAB:
        xs = [l["value"] for r in rs for l in r["lab_results"] if l["target"] == k and l["value"] is not None]
        if xs:
            v[k] = statistics.median(xs)
    probs = fx.detect(bp, v, None, a)
    return {"kind": "byproduct", "id": bp, "label": f"{BYPRODUCTS[bp]['label']} (type average, n={len(rs)})", "byproduct": bp,
            "values": v, "problems": probs, "overall_status": None, "safety_block": any(p["problem"] in ("aflatoxin", "pathogen") for p in probs)}


def get_profile(ctx, a=None):
    if ctx.get("sample_id"):
        r = rules.build_report(ctx["sample_id"])
        if not r:
            raise ValueError("Sample not found")
        return profile_from_report(r, a)
    bp = ctx.get("byproduct")
    if bp not in BYPRODUCTS:
        raise ValueError("Choose a sample or a by-product")
    p = type_profile(bp, all_reports(), a)
    if not p:
        raise ValueError("No samples for this by-product yet")
    return p


# ---------------- core model ----------------
def _scale(a, batch, ov):
    s = ov.get("scale", a["scale"])
    if s == "auto":
        s = "lab" if batch < 200 else "pilot" if batch < 2000 else "industrial"
    return a["scale_multipliers"][s], s


def run(prof, fix_list, a, point="typical", ov=None):
    ov, bp = ov or {}, prof["byproduct"]
    v = dict(prof["values"])
    g = lambda k: ov.get(k, a[k])
    batch = float(ov.get("batch_kg", a["batch_kg"]))
    rp = a["raw_price"][bp]
    raw_price = float(ov.get("raw_price", rp["typical"])) * (rp[point] / rp["typical"] if rp["typical"] else 1)
    fmult, tmult = ov.get("fix_cost_mult", 1.0), ov.get("testing_mult", 1.0)
    dig = ov.get("digestibility", a["digestibility"][bp])
    smult, scale = _scale(a, batch, ov)
    steps = list(fix_list) + [HANDLING]
    default_yield = math.prod(f["mass_yield"] for f in steps)
    k = ((ov["yield_pct"] / 100) / default_yield) ** (1 / len(steps)) if ov.get("yield_pct") else 1.0
    mass = batch
    prot = batch * (v.get("protein") or 0) / 100 * (1 - (v.get("moisture") or 10) / 100)
    flow = [{"step": "Raw batch", "fix_id": None, "mass": mass, "protein": prot, "cost_so_far": raw_price * batch}]
    items = [{"key": "raw", "label": "Raw material", "value": raw_price * batch}]
    hours = 0
    for f in steps:
        y, r = min(1.0, f["mass_yield"] * k), min(1.0, f["protein_recovery"] * k)
        cost = f[f"cost_{point}"] * mass * smult * fmult
        for key, fac in (f.get("effects") or {}).items():
            if key.endswith("_set"):
                v[key[:-4]] = fac
            elif v.get(key) is not None:
                v[key] = v[key] * fac
        nm, npr = mass * y, prot * r
        dig = min(0.98, dig + (f.get("digestibility_gain") or 0))
        if f["id"] != "handling":
            items.append({"key": "fix", "fix_id": f["id"], "label": f["action"], "value": cost})
        flow.append({"step": f["action"], "fix_id": f["id"], "mass": nm, "protein": npr, "mass_loss": mass - nm,
                     "protein_loss": prot - npr, "side_stream": f.get("side_stream") or "Loss", "cost": cost,
                     "cost_so_far": sum(i["value"] for i in items)})
        hours += f.get("time_h") or 0
        mass, prot = nm, npr
    m_after = v.get("moisture") or 10
    v["protein"] = min(92.0, prot / (mass * (1 - m_after / 100)) * 100) if mass else 0
    retest_lines = sorted({l for f in fix_list for l in (f.get("retest") or [])})
    items += [{"key": "testing", "label": "Initial testing panel", "value": sum(a["testing"].values()) * tmult},
              {"key": "retest", "label": "Retests after fixes", "value": sum(a["testing"][l] for l in retest_lines) * tmult},
              {"key": "labour", "label": "Labour", "value": g("labour_per_kg") * batch * smult},
              {"key": "energy", "label": "Energy", "value": g("energy_per_kg") * batch * smult},
              {"key": "packaging", "label": "Packaging", "value": g("packaging_per_kg") * mass},
              {"key": "transport", "label": "Transport", "value": g("transport_per_kg") * batch}]
    direct = sum(i["value"] for i in items)
    items.append({"key": "overhead", "label": f"Overhead ({g('overhead_pct'):g}%)", "value": direct * g("overhead_pct") / 100})
    total = sum(i["value"] for i in items)
    dig_kg = prot * dig
    pct = prot / mass * 100 if mass else 0
    met = {"total": total, "product_kg": mass, "protein_kg": prot, "digestible_protein_kg": dig_kg, "protein_pct": pct,
           "digestibility": dig, "mass_yield_pct": mass / batch * 100,
           "usable_protein_g_per_kg": pct * dig * 10,
           "per_kg_product": total / mass if mass else None, "per_kg_protein": total / prot if prot else None,
           "per_kg_dig": total / dig_kg if dig_kg else None,
           "per_serving": total / prot * SERVING_KG if prot else None,
           "kg_per_serving": SERVING_KG / (pct / 100) if pct else None}
    return {"items": items, "flow": flow, "values_after": v, "metrics": met, "retest_lines": retest_lines,
            "scale": scale, "batch_kg": batch, "raw_price": raw_price, "process_hours": hours}


def reject(prof, a, point="typical", ov=None, cat=None):
    ov, bp = ov or {}, prof["byproduct"]
    batch = float(ov.get("batch_kg", a["batch_kg"]))
    rp = a["raw_price"][bp]
    raw_price = float(ov.get("raw_price", rp["typical"])) * (rp[point] / rp["typical"] if rp["typical"] else 1)
    cat = cat or fx.catalogue()
    div = next((f for f in cat if f["status"] == "Divert or reject" and fx.applicable(f, bp)), None)
    disposal = (div[f"cost_{point}"] if div else 3) * batch
    items = [{"key": "raw", "label": "Raw material (value lost)", "value": raw_price * batch},
             {"key": "testing", "label": "Testing panel", "value": sum(a["testing"].values()) * ov.get("testing_mult", 1.0)},
             {"key": "transport", "label": "Transport", "value": ov.get("transport_per_kg", a["transport_per_kg"]) * batch},
             {"key": "disposal", "label": "Disposal / diversion handling", "value": disposal}]
    direct = sum(i["value"] for i in items)
    items.append({"key": "overhead", "label": f"Overhead ({a['overhead_pct']:g}%)", "value": direct * ov.get("overhead_pct", a["overhead_pct"]) / 100})
    items.append({"key": "credit", "label": "Diversion credit (permitted non-food use)", "value": -a["diversion_value_per_kg"] * batch})
    total = sum(i["value"] for i in items)
    return {"items": items, "metrics": {"total": total, "product_kg": 0, "protein_kg": 0, "loss_per_kg_raw": total / batch,
                                        "per_kg_product": None, "per_kg_protein": None, "per_kg_dig": None}, "batch_kg": batch}


def _po(ov, fixes):
    return {k: v for k, v in ov.items() if k != "yield_pct"} if fixes else ov


def expected(prof, fixes, a, ov, block, cat=None):
    p = ov.get("failure_prob", a["failure_prob"])
    ps, fd = run(prof, [], a, ov=_po(ov, fixes)), run(prof, fixes, a, ov=ov)
    if fixes and not block:
        tot = ps["metrics"]["total"] + p * (fd["metrics"]["total"] - ps["metrics"]["total"])
        dig = (1 - p) * ps["metrics"]["digestible_protein_kg"] + p * fd["metrics"]["digestible_protein_kg"]
        mode = "rework"
    else:
        tot = ps["metrics"]["total"] + p * reject(prof, a, ov=ov, cat=cat)["metrics"]["total"]
        dig, mode = ps["metrics"]["digestible_protein_kg"], "rejection"
    return {"total": tot, "per_kg_dig": tot / dig if dig else None, "failure_prob": p, "mode": mode}


# ---------------- visual payloads ----------------
def _rng(prof, fixes, a, ov, key):
    vals = [run(prof, fixes, a, pt, ov)["metrics"][key] for pt in ("low", "typical", "high")]
    return {"low": vals[0], "typical": vals[1], "high": vals[2]}


def _groups(items):
    out = {}
    for i in items:
        if i["value"] > 0:
            out[GROUP[i["key"]]] = out.get(GROUP[i["key"]], 0) + i["value"]
    return out


def _sankey(flow, key, rejected=False, batch=0):
    if rejected:
        return {"nodes": [{"label": "Raw batch", "kind": "main"}, {"label": "Rejected / diverted", "kind": "reject"}],
                "links": [{"source": 0, "target": 1, "value": batch if key == "mass" else flow[0][key]}]}
    nodes, links = [{"label": "Raw batch", "kind": "main"}], []
    for i, st in enumerate(flow[1:], 1):
        nodes.append({"label": f"{i}. {st['step']}", "kind": "step", "fix_id": st["fix_id"]})
        links.append({"source": len(nodes) - 2 if i > 1 else 0, "target": len(nodes) - 1, "value": flow[i - 1][key]})
    last = len(nodes) - 1
    for i, st in enumerate(flow[1:], 1):
        loss = st[f"{key}_loss"]
        if loss > 1e-6:
            nodes.append({"label": st["side_stream"], "kind": "side"})
            links.append({"source": i, "target": len(nodes) - 1, "value": loss})
    nodes.append({"label": "Product", "kind": "product"})
    links.append({"source": last, "target": len(nodes) - 1, "value": flow[-1][key]})
    return {"nodes": nodes, "links": links}


PARAMS = [("protein", "Protein", "% DM", "min"), ("oil", "Oil", "% DM", "max"), ("fibre_total", "Fibre", "% DM", "max"),
          ("gum", "Gum", "% DM", "max"), ("phytate", "Phytate", "mg/g", "max"), ("tannins", "Tannins", "mg/g", "max"),
          ("trypsin_inhibitor", "Trypsin inhibitor", "TIU/mg", "max"), ("moisture", "Moisture", "%", "max"),
          ("apc", "Aerobic plate count", "cfu/g", "max"), ("yeast_mould", "Yeast & mould", "cfu/g", "max"),
          ("water_activity", "Water activity", "aw", "max"), ("afb1", "Aflatoxin B1", "µg/kg", "max")]


def _before_after(before, after, a):
    th, t, out = rules.thresholds(), a["quality_targets"], []
    for k, label, unit, d in PARAMS:
        b = before.get(k)
        if b is None:
            continue
        lim = t.get(k) if k in t else (th[k].get("limit") if k == "afb1" else th[k]["review"])
        af = after.get(k, b)
        ok = (lambda x: x >= lim) if d == "min" else (lambda x: x <= lim)
        out.append({"key": k, "label": label, "unit": unit, "direction": d, "before": b, "after": af, "limit": lim,
                    "pass_before": ok(b), "pass_after": ok(af), "log": k in ("apc", "yeast_mould"),
                    "note": "No fix changes aflatoxin: divert or reject." if k == "afb1" and not ok(b) else ""})
    return out


def _timeline(prof, fixes, a, block):
    tasks, t = [], 0.0
    if block and not any(f["method"] == "kill_step" for f in fixes):
        for name, h, kind in (("Quarantine batch", 4, "fix"), ("Human review: divert or reject decision", a["review_h"], "review"),
                              ("Documented disposal / diversion", 24, "decision")):
            tasks.append({"task": name, "start": t, "end": t + h, "kind": kind, "mandatory": kind == "review"})
            t += h
        return tasks
    for f in fixes:
        tasks.append({"task": f["action"], "start": t, "end": t + f["time_h"], "kind": "fix", "fix_id": f["id"], "mandatory": False})
        t += f["time_h"]
    lines = sorted({l for f in fixes for l in f["retest"]}) or ["microbial", "aflatoxin"]
    h = max(a["lab_turnaround_h"].get(l, 48) for l in lines)
    tasks.append({"task": "Independent retest (new sample entry): safety gate", "start": t, "end": t + h, "kind": "retest", "mandatory": True, "lines": lines})
    t += h
    tasks.append({"task": "Human re-review", "start": t, "end": t + a["review_h"], "kind": "review", "mandatory": True})
    return tasks


def _tornado(prof, fixes, a, ov, block, cat):
    base = expected(prof, fixes, a, ov, block, cat)["per_kg_dig"]
    rp = a["raw_price"][prof["byproduct"]]["typical"]
    ylds = run(prof, fixes, a, ov=ov)["metrics"]["mass_yield_pct"]
    cur = lambda k, d: ov.get(k, d)
    specs = [("Raw price", "raw_price", cur("raw_price", rp), 0.25), ("Batch size", "batch_kg", cur("batch_kg", a["batch_kg"]), 0.5),
             ("Fix costs", "fix_cost_mult", cur("fix_cost_mult", 1.0), 0.25), ("Testing costs", "testing_mult", cur("testing_mult", 1.0), 0.25),
             ("Labour", "labour_per_kg", cur("labour_per_kg", a["labour_per_kg"]), 0.25), ("Energy", "energy_per_kg", cur("energy_per_kg", a["energy_per_kg"]), 0.25),
             ("Packaging", "packaging_per_kg", cur("packaging_per_kg", a["packaging_per_kg"]), 0.25), ("Overhead %", "overhead_pct", cur("overhead_pct", a["overhead_pct"]), 0.25),
             ("Process yield", "yield_pct", cur("yield_pct", ylds), 0.1), ("Digestibility", "digestibility", cur("digestibility", a["digestibility"][prof["byproduct"]]), 0.1),
             ("Failure probability", "failure_prob", cur("failure_prob", a["failure_prob"]), 0.5)]
    out = []
    for label, key, val, d in specs:
        lo_in, hi_in = val * (1 - d), val * (1 + d)
        if key == "yield_pct":
            hi_in = min(100.0, hi_in)
        if key == "digestibility":
            hi_in = min(0.98, hi_in)
        lo = expected(prof, fixes, a, {**ov, key: lo_in}, block, cat)["per_kg_dig"]
        hi = expected(prof, fixes, a, {**ov, key: hi_in}, block, cat)["per_kg_dig"]
        if lo is None or hi is None:
            continue
        out.append({"input": label, "key": key, "low_input": lo_in, "high_input": hi_in, "low": lo, "high": hi, "swing": abs(hi - lo)})
    return {"base": base, "rows": sorted(out, key=lambda r: r["swing"])}


def _tri(rnd, lo, mode, hi):
    return rnd.triangular(lo, hi, mode) if hi > lo else mode


def _monte_carlo(prof, fixes, a, ov, block, cat, n=500):
    rnd = random.Random(42)
    bp = prof["byproduct"]
    rp = a["raw_price"][bp]
    base_raw = ov.get("raw_price", rp["typical"])
    typ = sum(f["cost_typical"] for f in fixes) or 1
    flo, fhi = (sum(f["cost_low"] for f in fixes) / typ, sum(f["cost_high"] for f in fixes) / typ) if fixes else (1, 1)
    y0 = run(prof, fixes, a, ov=ov)["metrics"]["mass_yield_pct"]
    p = ov.get("failure_prob", a["failure_prob"])
    rej = reject(prof, a, ov=ov, cat=cat)["metrics"]["total"]
    draws = []
    for _ in range(n):
        o = {**ov, "raw_price": base_raw * _tri(rnd, rp["low"] / rp["typical"], 1, rp["high"] / rp["typical"]),
             "fix_cost_mult": ov.get("fix_cost_mult", 1.0) * _tri(rnd, flo, 1, fhi), "testing_mult": rnd.uniform(0.9, 1.25),
             "yield_pct": min(100.0, y0 * rnd.uniform(0.92, 1.04))}
        fail = rnd.random() < p
        if fixes and not block:
            m = run(prof, fixes, a, ov=o)["metrics"] if fail else run(prof, [], a, ov={**o, "yield_pct": None})["metrics"]
            draws.append(m["per_kg_dig"])
        else:
            m = run(prof, [], a, ov={**o, "yield_pct": None})["metrics"]
            draws.append((m["total"] + (rej if fail else 0)) / m["digestible_protein_kg"])
    draws.sort()
    q = lambda x: draws[min(n - 1, int(x * n))]
    lo, hi = draws[0], draws[-1]
    nb = 30
    w = (hi - lo) / nb or 1
    counts = [0] * nb
    for d in draws:
        counts[min(nb - 1, int((d - lo) / w))] += 1
    return {"bins": [lo + w * (i + 0.5) for i in range(nb)], "counts": counts, "width": w, "p10": q(0.1), "p50": q(0.5), "p90": q(0.9),
            "mean": sum(draws) / n, "n": n, "failure_prob": p}


BATCH_SIZES = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]


def _batch_curve(prof, fixes, a, ov):
    out = []
    for b in BATCH_SIZES:
        r = run(prof, fixes, a, ov={**ov, "batch_kg": b})
        out.append({"batch_kg": b, "per_kg_dig": r["metrics"]["per_kg_dig"], "per_kg_product": r["metrics"]["per_kg_product"], "scale": r["scale"]})
    return out


def conv_metrics(s):
    pp = s["protein_pct"] / 100
    m = lambda price: {"per_kg_product": price, "per_kg_protein": price / pp, "per_kg_dig": price / pp / s["digestibility"],
                       "per_serving": price / pp * SERVING_KG}
    lo, ty, hi = m(s["price_low"]), m(s["price_typical"]), m(s["price_high"])
    return {k: {"low": lo[k], "typical": ty[k], "high": hi[k]} for k in ty}


def _bisect(f, lo, hi, target, it=24):
    flo, fhi = f(lo), f(hi)
    if None in (flo, fhi):
        return None
    if fhi > target:
        return None
    if flo <= target:
        return lo
    for _ in range(it):
        mid = (lo + hi) / 2
        if f(mid) > target:
            lo = mid
        else:
            hi = mid
    return hi


def _breakeven(prof, fixes, a, ov, sources):
    c = lambda o: run(prof, fixes, a, ov={**ov, **o})["metrics"]["per_kg_dig"]
    rp = ov.get("raw_price", a["raw_price"][prof["byproduct"]]["typical"])
    c0, c1 = c({"raw_price": 0}), c({"raw_price": rp})
    slope = (c1 - c0) / rp if rp else 0
    f0, f1 = (c({"fix_cost_mult": 0}), c({"fix_cost_mult": 1})) if fixes else (None, None)
    fix_typ = sum(f["cost_typical"] for f in fixes)
    out = []
    for s in sources:
        tgt = conv_metrics(s)["per_kg_dig"]["typical"]
        raw_be = (tgt - c0) / slope if slope > 0 else None
        fix_be = ((tgt - f0) / (f1 - f0) * fix_typ) if fixes and f1 != f0 else None
        y_be = _bisect(lambda y: c({"yield_pct": y}), 3.0, 100.0, tgt)
        out.append({"key": s["key"], "name": s["name"], "target_per_kg_dig": tgt, "current_per_kg_dig": c1,
                    "max_raw_price": raw_be if raw_be is None or raw_be >= 0 else -1, "max_fix_cost_per_kg": fix_be if fix_be is None or fix_be >= 0 else -1,
                    "min_yield_pct": y_be})
    return {"intercept": c0, "slope": slope, "raw_typical": rp, "rows": out}


def estimate(ctx, fix_ids=None, ov=None, scenario=None, light=False):
    a, ov = fx.assumptions(), {k: v for k, v in (ov or {}).items() if v is not None}
    cat = fx.catalogue_map()
    prof = get_profile(ctx, a)
    bp = prof["byproduct"]
    if fix_ids is None:
        chosen = [] if prof["safety_block"] else fx.recommended(bp, prof["problems"], list(cat.values()))
    else:
        chosen = [cat[i] for i in fix_ids if i in cat]
    divert = any(f["status"] == "Divert or reject" for f in chosen)
    fixes = [f for f in chosen if f["status"] != "Divert or reject"]
    block = prof["safety_block"] or divert
    auto = "rejected" if block and not any(f["method"] == "kill_step" for f in fixes) else ("fixes" if fixes else "pass")
    scen = scenario if scenario in ("pass", "fixes", "rejected") else auto
    ps, fd, rj = run(prof, [], a, ov=_po(ov, fixes)), run(prof, fixes, a, ov=ov), reject(prof, a, ov=ov, cat=list(cat.values()))
    sel = {"pass": ps, "fixes": fd, "rejected": rj}[scen]
    exp = expected(prof, fixes, a, ov, block, list(cat.values()))
    sf = fixes if scen == "fixes" else []
    rng = {k: _rng(prof, sf, a, ov if sf else _po(ov, fixes), k) for k in ("per_kg_product", "per_kg_protein", "per_kg_dig", "per_serving")}
    scen_cards = []
    for key, name, tone, r in (("pass", "Passes first time", "green", ps), ("fixes", "Needs fixes", "amber", fd), ("rejected", "Rejected or diverted", "red", rj)):
        m = r["metrics"]
        scen_cards.append({"key": key, "name": name, "tone": tone, "total": m["total"], "per_kg_product": m.get("per_kg_product"),
                           "per_kg_dig": m.get("per_kg_dig"), "loss_per_kg_raw": m.get("loss_per_kg_raw"), "product_kg": m["product_kg"],
                           "groups": _groups(r["items"]),
                           "range": (_rng(prof, fixes, a, ov, "per_kg_dig") if key == "fixes" else _rng(prof, [], a, _po(ov, fixes), "per_kg_dig")) if key != "rejected" else None})
    denom = sel["metrics"]["product_kg"] or sel["batch_kg"]
    out = {
        "context": ctx, "profile": {k: prof[k] for k in ("kind", "id", "label", "byproduct", "overall_status", "safety_block")},
        "values_before": prof["values"], "problems": prof["problems"],
        "options": {p: [f["id"] for f in fs] for p, fs in fx.options(bp, prof["problems"], list(cat.values())).items()},
        "recommended": [] if prof["safety_block"] else [f["id"] for f in fx.recommended(bp, prof["problems"], list(cat.values()))],
        "fixes_used": [f["id"] for f in chosen], "scenario": scen, "auto_scenario": auto, "safety_block": block,
        "scale": fd["scale"], "batch_kg": fd["batch_kg"], "raw_price": fd["raw_price"],
        "inputs": {"batch_kg": fd["batch_kg"], "raw_price": ov.get("raw_price", a["raw_price"][bp]["typical"]),
                   "yield_pct": ov.get("yield_pct") or fd["metrics"]["mass_yield_pct"], "failure_prob": ov.get("failure_prob", a["failure_prob"]),
                   "default_yield_pct": run(prof, fixes, a, ov={k: v for k, v in ov.items() if k != "yield_pct"})["metrics"]["mass_yield_pct"],
                   "raw_price_default": a["raw_price"][bp]["typical"], "batch_default": a["batch_kg"], "failure_default": a["failure_prob"]},
        "metrics": {"pass": ps["metrics"], "fixes": fd["metrics"], "rejected": rj["metrics"], "expected": exp, "ranges": rng},
        "flow": fd["flow"], "values_after": fd["values_after"], "before_after": _before_after(prof["values"], fd["values_after"], a),
        "timeline": _timeline(prof, fixes, a, block),
        "sankey_mass": _sankey(fd["flow"], "mass", scen == "rejected", fd["batch_kg"]),
        "sankey_protein": _sankey(fd["flow"], "protein", scen == "rejected", fd["batch_kg"]),
        "waterfall": {"unit": "per kg product" if sel["metrics"]["product_kg"] else "per kg raw (no product)",
                      "items": [{**i, "per_kg": i["value"] / denom} for i in sel["items"]], "total": sel["metrics"]["total"] / denom},
        "breakdown": [{"group": GROUP[i["key"]], "label": i["label"], "value": i["value"]} for i in sel["items"]],
        "scenarios": scen_cards, "retest_lines": fd["retest_lines"],
        "demo_data": True, "illustrative": "Illustrative, replace with real quotes", "caveat": CAVEAT,
    }
    if not light:
        out["tornado"] = _tornado(prof, fixes, a, ov, block, list(cat.values()))
        out["monte_carlo"] = _monte_carlo(prof, fixes, a, ov, block, list(cat.values()))
        out["batch_curve"] = _batch_curve(prof, fixes, a, ov)
        out["breakeven"] = _breakeven(prof, fixes, a, ov, fx.conventional())
    return out


def relation(x, y):
    if x["high"] < y["low"]:
        return "cheaper"
    if x["low"] > y["high"]:
        return "more expensive"
    return "comparable"


def comparison(ov=None, fix_mode="recommended"):
    a, ov = fx.assumptions(), {k: v for k, v in (ov or {}).items() if v is not None}
    reps, cat = all_reports(), fx.catalogue()
    items, lines = [], []
    for bp in BYPRODUCTS:
        prof = type_profile(bp, reps, a)
        if not prof:
            continue
        fixes = fx.recommended(bp, prof["problems"], cat) if fix_mode == "recommended" else []
        o = {k: v for k, v in ov.items() if k != "raw_price"}
        if ov.get("raw_price_mult"):
            o["raw_price"] = a["raw_price"][bp]["typical"] * ov["raw_price_mult"]
        r = run(prof, fixes, a, ov=o)
        m = r["metrics"]
        crit = a["byproduct_criteria"][bp]
        items.append({"key": bp, "name": BYPRODUCTS[bp]["label"], "kind": "byproduct",
                      **{k: _rng(prof, fixes, a, o, k) for k in ("per_kg_product", "per_kg_protein", "per_kg_dig", "per_serving")},
                      "kg_per_serving": m["kg_per_serving"], "protein_pct": m["protein_pct"], "digestibility": m["digestibility"],
                      "allergen_risk": crit["allergen_risk"], "flavour": crit["flavour"], "supply": crit["supply"], "regulatory": crit["regulatory"],
                      "breakdown": {g: v / m["product_kg"] for g, v in _groups(r["items"]).items()},
                      "fixes": [{"id": f["id"], "action": f["action"]} for f in fixes], "problems": [p["label"] for p in prof["problems"]],
                      "mass_yield_pct": m["mass_yield_pct"]})
        c0 = run(prof, fixes, a, ov={**o, "raw_price": 0})["metrics"]["per_kg_dig"]
        rp = o.get("raw_price", a["raw_price"][bp]["typical"])
        lines.append({"key": bp, "name": BYPRODUCTS[bp]["label"], "intercept": c0, "slope": (m["per_kg_dig"] - c0) / rp if rp else 0,
                      "raw_typical": rp, "raw_low": a["raw_price"][bp]["low"], "raw_high": a["raw_price"][bp]["high"]})
    for s in fx.conventional():
        cm = conv_metrics(s)
        items.append({"key": s["key"], "id": s["id"], "name": s["name"], "kind": "conventional", **cm,
                      "kg_per_serving": SERVING_KG / (s["protein_pct"] / 100), "protein_pct": s["protein_pct"], "digestibility": s["digestibility"],
                      "allergen_risk": s["allergen_risk"], "flavour": s["flavour"], "supply": s["supply"], "regulatory": s["regulatory"],
                      "breakdown": {"Purchase price": s["price_typical"]}, "quality_basis": s["quality_basis"], "placeholder": bool(s["placeholder"])})
    return {"items": items, "lines": lines, "verdict": verdict(items), "fix_mode": fix_mode, "caveat": CAVEAT,
            "illustrative": "Illustrative, replace with real quotes", "demo_data": True}


def verdict(items, metric="per_kg_dig"):
    bps = [i for i in items if i["kind"] == "byproduct"]
    conv = [i for i in items if i["kind"] == "conventional"]
    if not bps or not conv:
        return None
    best = min(bps, key=lambda i: i[metric]["typical"])
    ref = next((c for c in conv if c["key"] == "spc"), min(conv, key=lambda c: c[metric]["typical"]))
    rel = relation(best[metric], ref[metric])
    rels = {c["key"]: relation(best[metric], c[metric]) for c in conv}
    word = {"cheaper": "lower cost than", "more expensive": "higher cost than", "comparable": "comparable with"}[rel]
    text = (f"{best['name']}: estimated ₹{best[metric]['low']:,.0f}–{best[metric]['high']:,.0f} per kg digestible protein vs "
            f"₹{ref[metric]['low']:,.0f}–{ref[metric]['high']:,.0f} for {ref['name'].lower()}: {word} it under current assumptions.")
    return {"best": best["key"], "reference": ref["key"], "relation": rel, "relations": rels, "text": text}


def report_summary(r):
    a = fx.assumptions()
    prof = profile_from_report(r, a)
    rng = _rng(prof, [], a, {}, "per_kg_protein")
    dig = _rng(prof, [], a, {}, "per_kg_dig")
    return {"per_kg_protein": rng, "per_kg_dig": dig, "basis": "As-is (no fixes), typical batch; placeholder INR",
            "problems": [p["label"] for p in prof["problems"]], "illustrative": "Illustrative, replace with real quotes"}
