"""PDF charts (reportlab drawings) for the Cost & Fix Hub export and the sample report. Placeholder INR values."""
import math
from io import BytesIO

from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics.shapes import Circle, Drawing, Line, Path, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

import fixes as fixcat

W = 180 * mm
WARM, GREEN, DARK, GREY, RED, AMBER = (colors.HexColor(c) for c in ("#d97706", "#15803d", "#1f4d36", "#a8a29e", "#b91c1c", "#b45309"))
REL_COL = {"cheaper": GREEN, "comparable": AMBER, "more expensive": RED, "reference": DARK}
SCEN_COL = {"pass": GREEN, "fixes": AMBER, "rejected": RED}
FIX_COL = {"Fixable": GREEN, "Human review required": AMBER, "Divert or reject": RED}
GROUP_COL = {k: colors.HexColor(v) for k, v in {"Raw material": "#9a5b3c", "Processing": "#d97706", "Testing": "#0369a1", "Overhead": "#78716c",
                                                "Disposal / diversion": "#b91c1c", "Purchase price": "#475569"}.items()}


def _cut(s, n):
    return s if len(s) <= n else s[:n - 3].rstrip() + "..."


def inr(v, d=0):
    return "-" if v is None else f"INR {v:,.{d}f}"


def _styles():
    ss = getSampleStyleSheet()
    return ss, ss["BodyText"].clone("s", fontSize=8, leading=10), ss["BodyText"].clone(
        "w", fontSize=8, leading=10, textColor=colors.HexColor("#92400e"), backColor=colors.HexColor("#fef3c7"), borderPadding=4)


def _table(rows, widths):
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), DARK), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                           ("FONTSIZE", (0, 0), (-1, -1), 7.5), ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#c9d6cc")),
                           ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return t


def hbars(rows, title, label_w=62 * mm):
    """rows: (label, low, typical, high, colour, tag)"""
    h = 14 + 13 * len(rows)
    d = Drawing(W, h)
    d.add(String(0, h - 9, title, fontName="Helvetica-Bold", fontSize=8))
    mx = max(r[3] for r in rows) * 1.05 or 1
    area = W - label_w - 105
    for i, (lab, lo, ty, hi, col, tag) in enumerate(rows):
        y = h - 24 - i * 13
        d.add(String(0, y + 2, lab[:42], fontSize=7))
        x0 = label_w + lo / mx * area
        d.add(Rect(x0, y, max(1.5, (hi - lo) / mx * area), 8, fillColor=col, strokeColor=None, fillOpacity=0.35))
        xt = label_w + ty / mx * area
        d.add(Line(xt, y - 1, xt, y + 9, strokeColor=col, strokeWidth=2))
        d.add(String(label_w + hi / mx * area + 3, y + 1, f"{lo:,.0f}-{hi:,.0f} {tag}", fontSize=6.5))
    return d


def waterfall(items, unit):
    rows = [i for i in items if abs(i["per_kg"]) > 1e-9]
    h = 30 + 12 * (len(rows) + 1)
    d = Drawing(W, h)
    d.add(String(0, h - 9, f"Cost build-up, INR {unit}", fontName="Helvetica-Bold", fontSize=8))
    tot = sum(i["per_kg"] for i in rows)
    mx = max(max(sum(r["per_kg"] for r in rows[:k + 1]) for k in range(len(rows))), tot) * 1.08 or 1
    lw, area, cum = 62 * mm, W - 62 * mm - 50, 0
    for k, r in enumerate(rows + [{"label": "Total", "per_kg": tot, "total": True}]):
        y = h - 24 - k * 12
        d.add(String(0, y + 1, r["label"][:42], fontSize=7))
        if r.get("total"):
            x0, w, col = lw, tot / mx * area, DARK
        else:
            a, b = cum, cum + r["per_kg"]
            x0, w, col = lw + min(a, b) / mx * area, abs(b - a) / mx * area, GREEN if r["per_kg"] < 0 else WARM
            cum = b
        d.add(Rect(x0, y, max(w, 1), 8, fillColor=col, strokeColor=None))
        d.add(String(x0 + max(w, 1) + 3, y + 1, f"{r['per_kg']:,.1f}", fontSize=6.5))
    return d


def paired(ba, title="Before vs after fix (projected). Dashed line = placeholder limit"):
    h = 18 + 18 * len(ba)
    d = Drawing(W, h)
    d.add(String(0, h - 9, title, fontName="Helvetica-Bold", fontSize=8))
    lw, area = 50 * mm, W - 50 * mm - 100
    tf = (lambda x: math.log10(max(x, 1))) 
    for i, p in enumerate(ba):
        y = h - 26 - i * 18
        f = tf if p["log"] else (lambda x: x)
        mx = max(f(p["before"]), f(p["after"]), f(p["limit"])) * 1.15 or 1
        d.add(String(0, y + 4, f"{p['label']} ({p['unit']})", fontSize=7))
        for j, (v, col) in enumerate(((p["before"], GREY), (p["after"], GREEN if p["pass_after"] else RED))):
            d.add(Rect(lw, y + 6 - j * 7, max(1, f(v) / mx * area), 5.5, fillColor=col, strokeColor=None))
        xl = lw + f(p["limit"]) / mx * area
        d.add(Line(xl, y - 2, xl, y + 13, strokeColor=DARK, strokeDashArray=[2, 2], strokeWidth=0.8))
        d.add(String(lw + area + 4, y + 4, f"{p['before']:,.3g} -> {p['after']:,.3g} {'OK' if p['pass_after'] else 'above limit' if p['direction'] == 'max' else 'below target'}", fontSize=6.5))
    return d


def donuts(est):
    d = Drawing(W, 140)
    act = est["scenario"]
    d.add(String(0, 131, "Scenario comparison: cost split per batch (donut) and cost per kg", fontName="Helvetica-Bold", fontSize=8))
    cw = W / 3
    blocked = est["auto_scenario"] == "rejected"
    for k, s in enumerate(est["scenarios"]):
        x0, tone = k * cw, SCEN_COL[s["key"]]
        if blocked and s["key"] != "rejected":
            d.add(Rect(x0 + 2, 120, cw - 8, 4, fillColor=GREY, strokeColor=None))
            d.add(String(x0 + 8, 108, s["name"], fontName="Helvetica-Bold", fontSize=7.5, fillColor=GREY))
            d.add(String(x0 + 8, 92, "N/A", fontName="Helvetica-Bold", fontSize=12, fillColor=GREY))
            d.add(String(x0 + 8, 82, "Safety failure: no fix makes this batch safe", fontSize=6.5, fillColor=GREY))
            continue
        if s["key"] == act:
            d.add(Rect(x0 + 2, 18, cw - 8, 106, fillColor=None, strokeColor=tone, strokeWidth=1.2))
        d.add(Rect(x0 + 2, 120, cw - 8, 4, fillColor=tone, strokeColor=None))
        d.add(String(x0 + 8, 108, s["name"] + (" (shown)" if s["key"] == act else ""), fontName="Helvetica-Bold", fontSize=7.5, fillColor=tone))
        val = s["per_kg_product"] if s["per_kg_product"] else s["loss_per_kg_raw"]
        d.add(String(x0 + 8, 92, inr(val, 1), fontName="Helvetica-Bold", fontSize=12))
        d.add(String(x0 + 8, 82, "per kg product" if s["per_kg_product"] else "lost per kg raw (no product)", fontSize=6.5, fillColor=GREY))
        d.add(String(x0 + 8, 72, f"{inr(s['total'])} per batch", fontSize=6.5))
        items = [(g, v) for g, v in s["groups"].items() if v > 0]
        if items:
            pc = Pie()
            pc.x, pc.y, pc.width, pc.height = x0 + cw - 70, 26, 56, 56
            pc.data, pc.labels, pc.simpleLabels = [v for _, v in items], None, 1
            pc.slices.strokeColor, pc.slices.strokeWidth = colors.white, 0.6
            for i, (g, _) in enumerate(items):
                pc.slices[i].fillColor = GROUP_COL.get(g, GREY)
            d.add(pc)
            d.add(Circle(x0 + cw - 42, 54, 17, fillColor=colors.white, strokeColor=None))
    groups = list(dict.fromkeys(g for s in est["scenarios"] for g, v in s["groups"].items() if v > 0))
    for i, g in enumerate(groups):
        d.add(Rect(i * 88, 4, 7, 7, fillColor=GROUP_COL.get(g, GREY), strokeColor=None))
        d.add(String(i * 88 + 10, 5, g, fontSize=6.5))
    return d


def _arrow(d, x1, y1, x2, y2, col, dash=False):
    d.add(Line(x1, y1, x2 - 4, y2, strokeColor=col, strokeWidth=0.9, strokeDashArray=[2.5, 2] if dash else None))
    d.add(Polygon([x2, y2, x2 - 5, y2 + 2.5, x2 - 5, y2 - 2.5], fillColor=col, strokeColor=None))


def _box(d, x, y, w, h, col, title, sub=""):
    d.add(Rect(x, y, w, h, fillColor=colors.white, strokeColor=colors.HexColor("#d6d3d1"), strokeWidth=0.5, rx=3, ry=3))
    d.add(Rect(x, y, 3, h, fillColor=col, strokeColor=None))
    d.add(String(x + 6, y + h - 8.5, _cut(title, 46), fontName="Helvetica-Bold", fontSize=6.5))
    if sub:
        d.add(String(x + 6, y + 2.8, _cut(sub, 58), fontSize=5.5, fillColor=colors.HexColor("#57534e")))


def fix_tree(est, cat):
    """Node-and-arrow diagram: problem -> fix options -> divert/reject terminal for safety failures."""
    rows, RH, GAP = [], 22, 6
    for p in est["problems"]:
        fs = [cat[i] for i in est["options"].get(p["problem"], []) if i in cat]
        rows.append((p, [f for f in fs if f["status"] != "Divert or reject"]))
    n = sum(max(len(o), 1) for _, o in rows)
    h = 22 + n * RH + GAP * len(rows)
    d = Drawing(W, h)
    fail = any(p["category"] == "safety" and p["status"] == "FAIL" for p, _ in rows)
    tail = "Safety failures end in divert or reject (human review)." if fail else \
        "Safety flags need human review." if any(p["category"] == "safety" for p, _ in rows) else "Every branch has a fix option."
    d.add(String(0, h - 9, f"Fix finder: {len(rows)} problem(s) -> fix options. {tail}", fontName="Helvetica-Bold", fontSize=8))
    used, y = set(est["fixes_used"]), h - 22
    px, fxx, tx, bw = 0, 170, 400, 150
    for p, opts in rows:
        k = max(len(opts), 1)
        block = k * RH
        safety = p["category"] == "safety"
        pc = RED if safety or p["status"] == "FAIL" else AMBER
        py = y - block / 2 - 9
        _box(d, px, py, bw, 18, pc, p["label"], f"{p['status']} - {p['cause']}")
        for i, f in enumerate(opts):
            fy = y - i * RH - 18
            col = FIX_COL[f["status"]]
            _box(d, fxx, fy, 210, 18, col, ("* " if f["id"] in used else "") + f["action"],
                 f"INR {f['cost_typical']:g}/kg - protein -{f['protein_loss_pct']:g}% - {f['status']}")
            _arrow(d, px + bw, py + 9, fxx, fy + 9, col, f["status"] != "Fixable")
            if safety:
                _arrow(d, fxx + 210, fy + 9, tx, py + 9, RED, True)
        if not opts and not safety:
            _box(d, fxx, py, 210, 18, GREY, "No catalogue option", "No fix listed for this by-product")
            _arrow(d, px + bw, py + 9, fxx, py + 9, GREY, True)
        if safety:
            _box(d, tx, py, W - tx, 18, RED, "Divert or reject", "Human review required")
            if not opts:
                _arrow(d, px + bw, py + 9, tx, py + 9, RED, True)
        y -= block + GAP
    return d


def fix_scores(f, allf):
    mc = max([x["cost_typical"] for x in allf] + [1])
    mt = max([x["time_h"] for x in allf] + [1])
    return [100 * (1 - math.log1p(f["cost_typical"]) / math.log1p(mc)), 100 * (1 - math.log1p(f["time_h"]) / math.log1p(mt)),
            f["protein_recovery"] * 100, f["effectiveness"] or 0, f["scale_ease"]]


CRIT = [("cost", "Cost"), ("protein", "Protein %"), ("digestibility", "Digestibility"), ("allergen", "Allergen risk"),
        ("flavour", "Flavour"), ("supply", "Supply"), ("regulatory", "Regulatory")]
DEFAULT_W = {"cost": 5, "protein": 3, "digestibility": 3, "allergen": 3, "flavour": 2, "supply": 2, "regulatory": 3}


def criteria_rank(items):
    min_c = min(i["per_kg_dig"]["typical"] for i in items)
    max_p = max(i["protein_pct"] for i in items)
    tw = sum(DEFAULT_W.values())
    out = []
    for i in items:
        s = {"cost": min_c / i["per_kg_dig"]["typical"] * 100, "protein": i["protein_pct"] / max_p * 100,
             "digestibility": min(100, i["digestibility"] * 100), "allergen": 100 - i["allergen_risk"] / 3 * 100,
             "flavour": i["flavour"], "supply": i["supply"], "regulatory": i["regulatory"]}
        out.append((i, [s[k] for k, _ in CRIT], sum(s[k] * DEFAULT_W[k] for k, _ in CRIT) / tw))
    return sorted(out, key=lambda t: -t[2])


def _radar(d, cx, cy, r, axes, series, title):
    n = len(axes)
    pt = lambda k, v: (cx + math.cos(math.pi / 2 - 2 * math.pi * k / n) * r * v / 100, cy + math.sin(math.pi / 2 - 2 * math.pi * k / n) * r * v / 100)
    d.add(String(cx - r - 30, cy + r + 22, title, fontName="Helvetica-Bold", fontSize=7.5))
    for ring in (25, 50, 75, 100):
        d.add(Polygon([c for k in range(n) for c in pt(k, ring)], fillColor=None, strokeColor=colors.HexColor("#d6d3d1"), strokeWidth=0.4))
    for k, a in enumerate(axes):
        x, y = pt(k, 100)
        d.add(Line(cx, cy, x, y, strokeColor=colors.HexColor("#d6d3d1"), strokeWidth=0.4))
        lx, ly = pt(k, 118)
        anchor = "middle" if abs(lx - cx) < 4 else ("start" if lx > cx else "end")
        d.add(String(lx, ly - 2, a, fontSize=5.8, textAnchor=anchor, fillColor=colors.HexColor("#57534e")))
    for name, vals, col, _ in series:
        d.add(Polygon([c for k, v in enumerate(vals) for c in pt(k, max(v, 2))], fillColor=col, fillOpacity=0.22, strokeColor=col, strokeWidth=1.2))
    for j, (name, vals, col, score) in enumerate(series):
        y = cy - r - 18 - j * 9
        d.add(Rect(cx - r - 20, y, 6, 6, fillColor=col, strokeColor=None))
        d.add(String(cx - r - 11, y + 0.5, f"{_cut(name, 40)} ({score:.0f}/100)", fontSize=6))


RADAR_C = [GREEN, WARM, colors.HexColor("#0369a1")]


def radars(est, comp, cat):
    allf = list(cat.values())
    used = [cat[i] for i in est["fixes_used"] if i in cat and cat[i]["status"] != "Divert or reject"]
    used = sorted(used, key=lambda f: -(f["effectiveness"] or 0) / max(f["cost_typical"], 0.5))[:3]
    ranked = criteria_rank(comp["items"])[:3] if comp and comp["items"] else []
    if not used and not ranked:
        return None
    d = Drawing(W, 200)
    if used:
        _radar(d, 115, 112, 58, ["Cost", "Speed", "Protein retention", "Effectiveness", "Scale-up"],
               [(f["action"], s, RADAR_C[k], sum(s) / len(s)) for k, (f, s) in enumerate((f, fix_scores(f, allf)) for f in used)],
               "Fix trade-offs (higher = better on every axis)")
    if ranked:
        _radar(d, 395 if used else 115, 112, 58, [l for _, l in CRIT],
               [(i["name"], s, RADAR_C[k], w) for k, (i, s, w) in enumerate(ranked)], "Multi-criteria ranking (default weights)")
    return d


def sankey(est):
    flow, h = est["flow"], 100 if est["scenario"] == "rejected" else 150
    d = Drawing(W, h)
    top, H, nw = h - 30, 64, 6
    if est["scenario"] == "rejected":
        d.add(String(0, h - 9, f"Mass flow: all {est['batch_kg']:,.0f} kg leaves the food chain (divert or reject after human review)", fontName="Helvetica-Bold", fontSize=8))
        d.add(Rect(0, top - H, nw, H, fillColor=DARK, strokeColor=None))
        d.add(Polygon([nw, top, W - 120, top, W - 120, top - H, nw, top - H], fillColor=RED, fillOpacity=0.3, strokeColor=None))
        d.add(Rect(W - 120, top - H, nw, H, fillColor=RED, strokeColor=None))
        d.add(String(0, top + 4, "Raw batch", fontSize=6.5))
        d.add(String(W - 110, top - H / 2, f"Rejected / diverted {est['batch_kg']:,.0f} kg", fontSize=6.5))
        return d
    prod = flow[-1]
    d.add(String(0, h - 9, f"Mass flow (projected): {prod['mass']:,.0f} of {flow[0]['mass']:,.0f} kg becomes product "
                           f"({prod['mass'] / flow[0]['mass'] * 100:.0f}%), {prod['protein'] / flow[0]['protein'] * 100:.0f}% of protein retained",
                 fontName="Helvetica-Bold", fontSize=8))
    sc, right = H / flow[0]["mass"], W - 70
    xs = [i * (right - nw) / max(len(flow) - 1, 1) for i in range(len(flow))]
    bot = 14
    for i, st in enumerate(flow):
        hh = st["mass"] * sc
        if i:
            x0, x1, hp = xs[i - 1] + nw, xs[i], flow[i - 1]["mass"] * sc
            d.add(Polygon([x0, top, x1, top, x1, top - hh, x0, top - hh], fillColor=GREEN, fillOpacity=0.22, strokeColor=None))
            t = hp - hh
            if t > 0.3:
                ex, dx = x0 + (x1 - x0) * 0.55, (x1 - x0) * 0.3
                p = Path(fillColor=WARM, fillOpacity=0.45, strokeColor=None)
                p.moveTo(x0, top - hh)
                p.curveTo(x0 + dx, top - hh, ex - dx, bot + t, ex, bot + t)
                p.lineTo(ex, bot)
                p.curveTo(ex - dx, bot, x0 + dx, top - hp, x0, top - hp)
                p.closePath()
                d.add(p)
                d.add(Rect(ex, bot, 2.5, t, fillColor=WARM, strokeColor=None))
                d.add(String(ex + 4, bot + 1, f"{_cut(st['side_stream'], 18)} {st['mass_loss']:,.0f} kg", fontSize=5.3, fillColor=colors.HexColor("#92400e")))
        d.add(Rect(xs[i], top - hh, nw, hh, fillColor=DARK if i == 0 else GREEN, strokeColor=None))
        lab = "Raw batch" if i == 0 else f"{i}. {st['step']}"
        d.add(String(xs[i], top + 4 + (8 if i % 2 else 0), _cut(lab, 26), fontSize=5.5))
        d.add(String(xs[i] + nw + 2, top - hh + 2, f"{st['mass']:,.0f} kg", fontSize=5.5, fillColor=colors.HexColor("#1f4d36")))
    hh = prod["mass"] * sc
    d.add(Polygon([xs[-1] + nw, top, W - 30, top, W - 30, top - hh, xs[-1] + nw, top - hh], fillColor=colors.HexColor("#0f766e"), fillOpacity=0.22, strokeColor=None))
    d.add(Rect(W - 30, top - hh, nw, hh, fillColor=colors.HexColor("#0f766e"), strokeColor=None))
    d.add(String(W - 30, top + 4, "Product", fontSize=6, fontName="Helvetica-Bold"))
    return d


def cost_section(est, comp, ss=None):
    ss, small, warn = _styles()
    m, rng = est["metrics"], est["metrics"]["ranges"]
    el = [Paragraph("Fixes and cost (illustrative)", ss["Heading2"]),
          Paragraph("<b>Illustrative, replace with real quotes.</b> All prices are PLACEHOLDER INR assumptions. " + est["caveat"], warn), Spacer(1, 6)]
    fx = m["fixes"]
    blocked = est["auto_scenario"] == "rejected"
    if est["scenario"] == "rejected" or blocked:
        rj = m["rejected"]
        kpi = [["Metric", "Value"], ["Scenario shown", "Rejected or diverted (human review required)"],
               ["Product for food use", f"None: all {est['batch_kg']:,.0f} kg is diverted or rejected"],
               ["Cost of the rejected batch", inr(rj["total"])], ["Loss per kg raw material", inr(rj["loss_per_kg_raw"], 1)]]
    else:
        kpi = None
    kpi = kpi or [["Metric", "Value"], ["Scenario shown", est["scenario"]],
           ["Cost per kg product", f"{inr(rng['per_kg_product']['low'])} - {inr(rng['per_kg_product']['high'])}"],
           ["Cost per kg protein", f"{inr(rng['per_kg_protein']['low'])} - {inr(rng['per_kg_protein']['high'])}"],
           ["Cost per kg digestible protein", f"{inr(rng['per_kg_dig']['low'])} - {inr(rng['per_kg_dig']['high'])}"],
           ["Expected cost per kg digestible protein", inr(m["expected"]["per_kg_dig"])],
           ["Mass yield after fixes (projected)", f"{fx['mass_yield_pct']:.0f}% ({fx['product_kg']:,.0f} kg of {est['batch_kg']:,.0f} kg)"]]
    el += [_table(kpi, [80 * mm, 100 * mm]), Spacer(1, 6)]
    cat = fixcat.catalogue_map()
    if est["problems"]:
        el += [fix_tree(est, cat), Spacer(1, 4),
               Paragraph("* = in the selected fix stack. Dashed arrow = needs validation or human review.", small), Spacer(1, 6)]
    if est.get("fix_rows"):
        rows = [["Selected fix", "INR/kg input", "Protein loss", "Retest"]] + est["fix_rows"]
        el += [_table(rows, [80 * mm, 30 * mm, 25 * mm, 45 * mm]), Spacer(1, 6)]
    rd = radars(est, comp, cat)
    if rd:
        el += [rd, Spacer(1, 6)]
    if est["before_after"]:
        rej = est["scenario"] == "rejected"
        el += [paired(est["before_after"], "Measured vs placeholder limits: no fix applied (divert or reject, human review)") if rej
               else paired(est["before_after"]), Spacer(1, 6)]
    el += [sankey(est), Spacer(1, 6)]
    el += [waterfall(est["waterfall"]["items"], est["waterfall"]["unit"]), Spacer(1, 6)]
    el += [donuts(est), Spacer(1, 6)]
    na = "Not applicable: safety failure"
    sc = [["Scenario", "Total per batch", "Per kg product", "Per kg digestible protein"]] + [
        [s["name"], na, "-", "-"] if blocked and s["key"] != "rejected" else
        [s["name"], inr(s["total"]), inr(s["per_kg_product"]) if s["per_kg_product"] else f"no product (loss {inr(s['loss_per_kg_raw'], 1)}/kg raw)",
         inr(s["per_kg_dig"])] for s in est["scenarios"]]
    el += [_table(sc, [50 * mm, 40 * mm, 50 * mm, 40 * mm]), Spacer(1, 8)]
    if comp:
        v = comp["verdict"]
        ref = v["best"] if v else None
        rows = []
        bestr = next((i["per_kg_dig"] for i in comp["items"] if i["key"] == ref), None)
        for i in sorted(comp["items"], key=lambda i: i["per_kg_dig"]["typical"]):
            r = i["per_kg_dig"]
            rel = "reference" if i["key"] == ref else ("comparable" if not bestr else
                  "cheaper" if r["high"] < bestr["low"] else "more expensive" if r["low"] > bestr["high"] else "comparable")
            rows.append((i["name"], r["low"], r["typical"], r["high"], REL_COL[rel], f"({rel})"))
        el += [hbars(rows, "Cost per kg digestible protein, INR (range bars; overlapping = comparable)"), Spacer(1, 4)]
        if v:
            el += [Paragraph("<b>Verdict:</b> " + v["text"].replace("₹", "INR "), ss["BodyText"]), Spacer(1, 4)]
    return el


def render_hub(est, comp, title):
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm)
    ss, _, warn = _styles()
    el = [Paragraph("ByProduct Analyser - Cost and Fix Hub", ss["Title"]), Paragraph(title, ss["Heading3"]),
          Paragraph("<b>DEMO DATA.</b> This tool does not certify food safety. Confirmed results from an accredited laboratory are required. "
                    "No fix makes a batch safe: safety failures are diverted or rejected after human review.", warn), Spacer(1, 6)]
    el += cost_section(est, comp)
    be = est.get("breakeven")
    if be:
        rows = [["Conventional source", "Its INR/kg dig. protein", "Max raw price", "Min yield", "Max fix cost/kg"]]
        for r in be["rows"]:
            rows.append([r["name"], inr(r["target_per_kg_dig"]),
                         "not reachable" if r["max_raw_price"] in (None, -1) else inr(r["max_raw_price"], 1),
                         "not reachable" if r["min_yield_pct"] is None else f"{r['min_yield_pct']:.0f}%",
                         "-" if r["max_fix_cost_per_kg"] is None else ("not reachable" if r["max_fix_cost_per_kg"] == -1 else inr(r["max_fix_cost_per_kg"], 1))])
        el += [Paragraph("Break-even vs conventional sources", ss["Heading3"]), _table(rows, [55 * mm, 32 * mm, 31 * mm, 26 * mm, 36 * mm])]
    doc.build(el)
    return buf.getvalue()
