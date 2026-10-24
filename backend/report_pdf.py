from io import BytesIO
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

STATUS_COL = {"PASS": "#15803d", "REVIEW": "#b45309", "RETEST": "#c2410c", "FAIL": "#b91c1c"}


def _table(rows, widths):
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f4d36")),
                           ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTSIZE", (0, 0), (-1, -1), 8),
                           ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#c9d6cc")),
                           ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return t


def _v(x, d=2):
    return "-" if x is None else f"{x:.{d}f}"


def render(r):
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm)
    ss = getSampleStyleSheet()
    small = ss["BodyText"].clone("small", fontSize=8, leading=10)
    warn = ss["BodyText"].clone("warn", fontSize=8, leading=10, textColor=colors.HexColor("#92400e"),
                                backColor=colors.HexColor("#fef3c7"), borderPadding=4)
    s, sc = r["sample"], r["suitability"]
    el = [Paragraph("ByProduct Analyser - Sample Report", ss["Title"]),
          Paragraph("<b>DEMO DATA</b> - synthetic values generated for demonstration only.", warn), Spacer(1, 4),
          Paragraph(r["disclaimer"], warn), Spacer(1, 8)]
    meta = [["Sample ID", s["sample_code"], "By-product", s["byproduct_label"]],
            ["Supplier", s["supplier"] or "-", "Batch", s["batch"] or "-"],
            ["Date", s["sample_date"] or "-", "Storage", Paragraph(s["storage_history"] or "-", small)]]
    el += [_table([["", "", "", ""]] + meta, [28 * mm, 55 * mm, 28 * mm, 69 * mm]), Spacer(1, 8)]
    el += [Paragraph(f"<b>Overall screening status:</b> <font color='{STATUS_COL[r['overall_status']]}'>{r['overall_status']}</font> &nbsp; "
                     f"<b>Suitability score:</b> {sc['score']}/100 &nbsp; <b>Safe usable protein:</b> {sc['safe_usable_protein_g_per_kg']} g/kg", ss["BodyText"]),
           Paragraph(sc["explanation"], small), Spacer(1, 8)]
    for title, items in (("Composition profile", r["composition"]), ("Anti-nutritional factors", r["anf"])):
        rows = [["Target", "Value", "Unit", "± error", "Source", "Note"]]
        for c in items:
            note = "Lab assay recommended: NIR prediction is unreliable" if c.get("lab_assay_recommended") else (c.get("lab_method") or "")
            rows.append([c["label"], _v(c["value"]), c["unit"], _v(c["error"]) if c["source"] == "AI prediction" else "-",
                         c["source"] or "Not available", Paragraph(note, small)])
        el += [Paragraph(title, ss["Heading3"]), _table(rows, [42 * mm, 18 * mm, 16 * mm, 16 * mm, 26 * mm, 62 * mm]), Spacer(1, 6)]
    rows = [["Check", "Category", "Status", "Value", "Message"]]
    for f in r["safety_flags"]:
        rows.append([f["label"], f["category"], f["status"], f["value"] or "-", Paragraph(f["message"], small)])
    el += [Paragraph("Safety screening (rule-based, placeholder thresholds - check current FSSAI requirements)", ss["Heading3"]),
           _table(rows, [36 * mm, 28 * mm, 16 * mm, 24 * mm, 76 * mm]), Spacer(1, 6)]
    if r["anomalies"] or r["retests"]:
        rows = [["Test", "Status", "Reason"]] + [[x["test"], x["status"], Paragraph(x["reason"], small)] for x in r["retests"]]
        el += [Paragraph("Retest flags", ss["Heading3"]), _table(rows, [40 * mm, 18 * mm, 122 * mm])]
    if r["human_review_required"]:
        el += [Spacer(1, 6), Paragraph("<b>Human review required</b> before any decision on this sample.", warn)]
    doc.build(el)
    return buf.getvalue()
