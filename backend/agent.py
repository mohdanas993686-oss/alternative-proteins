"""Analysis Agent: read-only tools + LLM (Claude / ChatGPT) planning and drafting, with rule-based fallback."""
import asyncio
import json
import os
import re
import uuid
import db
import rules
from ml import predictor
from ml.synth import BYPRODUCTS

PROVIDERS = {"claude": ("anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5"),
             "chatgpt": ("openai", "gpt-5.6-terra", "ChatGPT (GPT-5.6 Terra)")}

GUARDRAILS = """You are the ByProduct Analyser Analysis Agent. All data is SYNTHETIC DEMO DATA.
Strict rules:
- NEVER call a sample "safe", "pathogen-free", "cleared for food use", "approved" or say a hazard is "absent".
  Only say "not detected by this test", flag risks and recommend confirmation by an accredited laboratory.
- You are read-only: you cannot change or delete lab results.
- Any positive, uncertain or failing safety result must be described as needing human review.
- ANF values predicted by NIR are unreliable; recommend lab assays for phytate, tannins and trypsin inhibitors.
- Be concise and plain-language for non-technical users (students, lab staff, food technologists).
Format: plain text, short section headings ending with a colon, bullet lines starting with "- ". No markdown tables, no ** or #."""

TOOL_DOCS = {
    "get_sample": "get_sample(id): fetch sample details, history and existing lab results",
    "run_prediction": "run_prediction(id): run NIR models, return composition values with error estimates and anomalies",
    "check_safety_rules": "check_safety_rules(id): run rule engine on aflatoxin, microbial and allergen entries",
    "compare_byproducts": "compare_byproducts(ids): rank samples (list of ids) or, if ids empty, by-product types",
    "find_missing_data": "find_missing_data(id): list lab results still needed for a complete report",
    "generate_report": "generate_report(id): build the final report draft (score, flags, composition)",
    "suggest_retests": "suggest_retests(id): propose lab tests to repeat or confirm",
}

BANNED = [
    (re.compile(r"\bpathogen[- ]free\b", re.I), "pathogens not detected by this test"),
    (re.compile(r"\bcleared for (human )?food use\b", re.I), "[clearance can only come from an accredited laboratory and human reviewer]"),
    (re.compile(r"\bsafe (for|to) (human )?(consumption|eat|use)\b", re.I), "[safety cannot be certified by this tool]"),
    (re.compile(r"\b(is|are|was|were|be) (completely |totally |fully )?safe\b", re.I), r"\1 not certified as safe by this tool"),
    (re.compile(r"\babsent\b", re.I), "not detected by this test"),
]


def sanitize(text):
    for rx, rep in BANNED:
        text = rx.sub(rep, text)
    return text


def llm_available():
    return bool(os.environ.get("EMERGENT_LLM_KEY"))


async def llm_stream(system, text, provider):
    from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone
    prov, model, _ = PROVIDERS.get(provider, PROVIDERS["claude"])
    chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=uuid.uuid4().hex,
                   system_message=system).with_model(prov, model)
    async for ev in chat.stream_message(UserMessage(text=text)):
        if isinstance(ev, TextDelta):
            yield ev.content
        elif isinstance(ev, StreamDone):
            break


async def llm_complete(system, text, provider):
    return "".join([d async for d in llm_stream(system, text, provider)])


# ---------------- tools (read-only) ----------------
def _resolve(sid):
    s = db.one("SELECT * FROM samples WHERE id=? OR lower(sample_code)=lower(?)", (str(sid), str(sid)))
    if not s:
        raise ValueError(f"Sample '{sid}' not found")
    return s


def get_sample(id):
    s = _resolve(id)
    labs = rules.latest_labs(s["id"])
    runs = db.one("SELECT COUNT(DISTINCT run_id) n FROM agent_logs WHERE sample_id=?", (s["id"],))["n"]
    return {"sample": rules.sample_public(s), "previous_agent_runs": runs,
            "lab_results": [{"target": r["target"], "value": r["value"], "result": r["result"], "method": r["method"],
                             "confirmation": r["confirmation"], "notes": r["notes"]} for r in labs.values()]}


def run_prediction(id):
    s = _resolve(id)
    if not s["spectrum"]:
        return {"error": "No spectrum on file. Scan or upload a spectrum first."}
    preds = predictor.predict(json.loads(s["spectrum"]), s["byproduct"])
    pmap = {p["target"]: p for p in preds}
    return {"predictions": preds, "anomalies": rules.anomalies(s, pmap, rules.latest_labs(s["id"])),
            "note": "AI predictions from models trained on synthetic data. ANF predictions are unreliable."}


def check_safety_rules(id):
    s = _resolve(id)
    flags, overall = rules.evaluate_safety(s, rules.latest_labs(s["id"]), rules.latest_preds(s["id"]))
    return {"overall": overall, "flags": [{k: f[k] for k in ("label", "category", "status", "message", "value", "method")} for f in flags],
            "note": "Rule-based screening against placeholder thresholds. Not a food-safety certification."}


def compare_byproducts(ids=None):
    samples = [_resolve(i) for i in ids] if ids else db.query("SELECT * FROM samples")
    reps = [rules.build_report(s["id"]) for s in samples]
    if ids:
        rows = [{"sample": r["sample"]["sample_code"], "byproduct": r["sample"]["byproduct_label"],
                 "score": r["suitability"]["score"], "usable_protein_g_per_kg": r["suitability"]["safe_usable_protein_g_per_kg"],
                 "overall": r["overall_status"]} for r in reps]
        return {"ranking": sorted(rows, key=lambda x: -x["score"])}
    return {"ranking": compare_types(reps)}


def compare_types(reps):
    out = []
    for bp, meta in BYPRODUCTS.items():
        rs = [r for r in reps if r["sample"]["byproduct"] == bp]
        if not rs:
            continue
        avg = lambda f: round(sum(f(r) for r in rs) / len(rs), 2)
        val = lambda r, k, grp="composition": next((c["value"] or 0 for c in r[grp] if c["key"] == k), 0)
        out.append({"byproduct": bp, "label": meta["label"], "n_samples": len(rs),
                    "avg_score": avg(lambda r: r["suitability"]["score"]),
                    "avg_base_score": avg(lambda r: r["suitability"]["base_score"]),
                    "avg_protein": avg(lambda r: val(r, "protein")), "avg_oil": avg(lambda r: val(r, "oil")),
                    "avg_fibre": avg(lambda r: val(r, "fibre_total")), "avg_moisture": avg(lambda r: val(r, "moisture")),
                    "avg_phytate": avg(lambda r: val(r, "phytate", "anf")), "avg_tannins": avg(lambda r: val(r, "tannins", "anf")),
                    "avg_tia": avg(lambda r: val(r, "trypsin_inhibitor", "anf")),
                    "avg_usable_protein": avg(lambda r: r["suitability"]["safe_usable_protein_g_per_kg"]),
                    "flagged": sum(r["overall_status"] in ("FAIL", "RETEST") for r in rs),
                    "inherent_allergens": meta["allergens"]})
    return sorted(out, key=lambda x: -x["avg_score"])


def find_missing_data(id):
    s = _resolve(id)
    return {"missing": rules.missing_data(s, rules.latest_labs(s["id"]), rules.latest_preds(s["id"]))}


def generate_report(id):
    r = rules.build_report(_resolve(id)["id"])
    return {"sample": r["sample"]["sample_code"], "byproduct": r["sample"]["byproduct_label"],
            "overall_status": r["overall_status"], "suitability_score": r["suitability"]["score"],
            "safe_usable_protein_g_per_kg": r["suitability"]["safe_usable_protein_g_per_kg"],
            "composition": {c["key"]: {"value": c["value"], "unit": c["unit"], "source": c["source"], "error": c["error"]} for c in r["composition"]},
            "anf": {c["key"]: {"value": c["value"], "unit": c["unit"], "source": c["source"], "lab_assay_recommended": c.get("lab_assay_recommended")} for c in r["anf"]},
            "human_review_required": r["human_review_required"], "n_anomalies": len(r["anomalies"])}


def suggest_retests(id):
    r = rules.build_report(_resolve(id)["id"])
    return {"retests": r["retests"]}


TOOLS = {"get_sample": get_sample, "run_prediction": run_prediction, "check_safety_rules": check_safety_rules,
         "compare_byproducts": compare_byproducts, "find_missing_data": find_missing_data,
         "generate_report": generate_report, "suggest_retests": suggest_retests}


def summarize(tool, res):
    if "error" in res:
        return res["error"]
    if tool == "get_sample":
        s = res["sample"]
        return f"{s['sample_code']} · {s['byproduct_label']} · supplier {s['supplier']} · {len(res['lab_results'])} lab results on file"
    if tool == "run_prediction":
        p = {x["target"]: x for x in res["predictions"]}
        parts = [f"{k} {p[k]['value']:.1f} ± {p[k]['error']:.1f}" for k in ("protein", "oil", "moisture", "fibre_total") if k in p]
        return "; ".join(parts) + f" · {len(res['anomalies'])} anomaly flag(s)"
    if tool == "check_safety_rules":
        c = {s: sum(f["status"] == s for f in res["flags"]) for s in rules.RANK}
        return f"Overall {res['overall']} · FAIL {c['FAIL']}, RETEST {c['RETEST']}, REVIEW {c['REVIEW']}, PASS {c['PASS']}"
    if tool == "compare_byproducts":
        top = res["ranking"][:3]
        return "Ranking: " + ", ".join(f"{t.get('label') or t.get('sample')} ({t.get('avg_score', t.get('score'))})" for t in top)
    if tool == "find_missing_data":
        return f"{len(res['missing'])} item(s) missing" + (": " + ", ".join(m["label"] for m in res["missing"][:4]) if res["missing"] else "")
    if tool == "generate_report":
        return f"Suitability score {res['suitability_score']}/100 · usable protein {res['safe_usable_protein_g_per_kg']} g/kg · overall {res['overall_status']}"
    if tool == "suggest_retests":
        return f"{len(res['retests'])} retest/confirmation(s) proposed"
    return "done"


REASONS = {
    "get_sample": "Start by loading the sample record and existing lab entries so every later step uses the same facts.",
    "run_prediction": "Run the NIR calibration models for this by-product and check predictions against typical ranges.",
    "check_safety_rules": "Apply the rule engine to aflatoxin, microbial and allergen entries (placeholder thresholds).",
    "find_missing_data": "List what is still needed before this report can be complete.",
    "suggest_retests": "Propose tests to repeat or confirm, based on flags, anomalies and unreliable ANF predictions.",
    "generate_report": "Assemble the report draft and suitability score.",
    "compare_byproducts": "Rank by-products/samples by suitability score using the same scoring rules.",
}


def _log(run_id, sample_id, step, kind, tool=None, args=None, result=None, reasoning=None):
    db.insert("agent_logs", {"id": db.new_id(), "run_id": run_id, "sample_id": sample_id, "step": step, "kind": kind,
                             "tool": tool, "args": json.dumps(args) if args is not None else None,
                             "result": json.dumps(result)[:20000] if result is not None else None,
                             "reasoning": reasoning, "created_at": db.now()})


def _ev(**k):
    return f"data: {json.dumps(k, default=str)}\n\n"


async def _execute(plan, run_id, sample_id, results):
    for i, (tool, args, why) in enumerate(plan, 1):
        yield _ev(type="step", step=i, tool=tool, args=args, reasoning=why, status="running")
        await asyncio.sleep(0.3)
        try:
            res = await asyncio.to_thread(TOOLS[tool], **args)
        except Exception as e:
            res = {"error": str(e)}
        summ = summarize(tool, res)
        results.append({"tool": tool, "args": args, "result": res})
        _log(run_id, sample_id, i, "tool_call", tool, args, res, why)
        yield _ev(type="step_result", step=i, tool=tool, summary=summ, result=res,
                  status="error" if "error" in res else "done")


async def _draft(system, prompt, provider, fallback, run_id, sample_id, step):
    text, used_llm = "", False
    if llm_available():
        try:
            async for d in llm_stream(system, prompt, provider):
                text += d
                yield _ev(type="text", delta=d)
            used_llm = True
        except Exception as e:
            yield _ev(type="notice", message=f"LLM unavailable ({type(e).__name__}); using rule-based assistant.")
            text = ""
    if not text:
        text = fallback()
    final = sanitize(text)
    _log(run_id, sample_id, step, "final", result={"text": final, "llm": used_llm, "provider": provider if used_llm else "rule-based"})
    yield _ev(type="final", text=final, llm=used_llm,
              provider=PROVIDERS.get(provider, PROVIDERS["claude"])[2] if used_llm else "Rule-based assistant")


def _compact(results):
    return json.dumps([{"tool": r["tool"], "result": r["result"]} for r in results], default=str)[:14000]


def _fallback_report(results):
    by = {r["tool"]: r["result"] for r in results}
    rep, safe, miss, ret = by.get("generate_report", {}), by.get("check_safety_rules", {}), by.get("find_missing_data", {}), by.get("suggest_retests", {})
    pred = by.get("run_prediction", {})
    lines = [f"Summary:", f"- Sample {rep.get('sample')} ({rep.get('byproduct')}) has a suitability score of {rep.get('suitability_score')}/100 "
             f"and an overall screening status of {rep.get('overall_status')}.",
             f"- Estimated usable protein: {rep.get('safe_usable_protein_g_per_kg')} g/kg (after safety factor).", "", "Safety flags:"]
    for f in safe.get("flags", []):
        if f["status"] != "PASS":
            lines.append(f"- {f['label']}: {f['status']} - {f['message']}")
    if pred.get("anomalies"):
        lines += ["", "Anomalies:"] + [f"- {a['message']}" for a in pred["anomalies"]]
    lines += ["", "Recommended next steps:"] + [f"- {r['test']}: {r['reason']}" for r in ret.get("retests", [])[:8]]
    if miss.get("missing"):
        lines += ["", "Still missing:"] + [f"- {m['label']}" for m in miss["missing"][:8]]
    lines += ["", "This draft is not a safety certification. Confirmed results from an accredited laboratory and human review are required."]
    return "\n".join(lines)


async def full_analysis(sample_id, provider):
    s = _resolve(sample_id)
    run_id = db.new_id()
    yield _ev(type="run", run_id=run_id, llm=llm_available())
    plan = [(t, {"id": s["id"]}, REASONS[t]) for t in
            ("get_sample", "run_prediction", "check_safety_rules", "find_missing_data", "suggest_retests", "generate_report")]
    results = []
    async for e in _execute(plan, run_id, s["id"], results):
        yield e
    prompt = ("Tool results for this sample (JSON):\n" + _compact(results) +
              "\n\nWrite a plain-language report draft with these sections: Summary:, Composition:, Safety screening:, "
              "Anomalies:, Recommended next steps:. Explain what each tool showed in one line where useful. Under 300 words.")
    async for e in _draft(GUARDRAILS, prompt, provider, lambda: _fallback_report(results), run_id, s["id"], len(plan) + 1):
        yield e
    rep = rules.build_report(s["id"])
    yield _ev(type="done", human_review_required=rep["human_review_required"], overall=rep["overall_status"])


def _keyword_plan(message, sample_id):
    m = message.lower()
    sid = sample_id
    found = re.search(r"\b([a-z]{2,4}-\d{2,4})\b", m)
    if found and db.one("SELECT id FROM samples WHERE lower(sample_code)=?", (found.group(1),)):
        sid = found.group(1)
    plan = []
    if any(w in m for w in ("best", "rank", "compare", "which by-product", "which byproduct", "flour")) and not found:
        plan.append(("compare_byproducts", {"ids": []}, REASONS["compare_byproducts"]))
    if sid:
        plan.append(("get_sample", {"id": sid}, REASONS["get_sample"]))
        if any(w in m for w in ("flag", "why", "safety", "aflatoxin", "salmonella", "fail", "retest")):
            plan += [("check_safety_rules", {"id": sid}, REASONS["check_safety_rules"]),
                     ("suggest_retests", {"id": sid}, REASONS["suggest_retests"])]
        if any(w in m for w in ("missing", "need", "complete")):
            plan.append(("find_missing_data", {"id": sid}, REASONS["find_missing_data"]))
        if any(w in m for w in ("protein", "composition", "predict", "oil", "fibre", "moisture")):
            plan.append(("run_prediction", {"id": sid}, REASONS["run_prediction"]))
        if len(plan) == 1:
            plan.append(("generate_report", {"id": sid}, REASONS["generate_report"]))
    if not plan:
        plan.append(("compare_byproducts", {"ids": []}, REASONS["compare_byproducts"]))
    return plan


async def _llm_plan(message, sample_id, history, provider):
    sys = ("You plan tool calls for an analysis agent. Available tools:\n" + "\n".join(TOOL_DOCS.values()) +
           '\nReturn ONLY JSON: {"steps":[{"tool":"name","args":{"id":"..."} or {"ids":[...]},"reason":"short why"}]} with 1-5 steps. '
           "Sample ids may be internal ids or sample codes like GUA-001.")
    ctx = f"Current sample in view: {sample_id or 'none'}\nRecent conversation: {history}\nUser question: {message}"
    raw = await llm_complete(sys, ctx, provider)
    data = json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
    plan = []
    for st in data.get("steps", [])[:5]:
        t, a = st.get("tool"), st.get("args") or {}
        if t not in TOOLS:
            continue
        a = {"ids": list(a.get("ids") or [])} if t == "compare_byproducts" else {"id": a.get("id") or sample_id}
        if t != "compare_byproducts" and not a["id"]:
            continue
        plan.append((t, a, st.get("reason") or REASONS[t]))
    return plan


def _fallback_answer(message, results):
    lines = ["Here is what I found using the app's own tools (rule-based assistant):", ""]
    for r in results:
        res = r["result"]
        if "error" in res:
            lines.append(f"- {r['tool']}: {res['error']}")
        elif r["tool"] == "compare_byproducts":
            lines.append("Ranking by average suitability score:")
            for i, x in enumerate(res["ranking"], 1):
                lines.append(f"- {i}. {x.get('label') or x.get('sample')}: score {x.get('avg_score', x.get('score'))}"
                             + (f", avg protein {x['avg_protein']}% DM, {x['flagged']} flagged sample(s)" if 'avg_protein' in x else ""))
            lines.append("- Scores combine protein, fibre, oil, ANF load and a safety factor. Real lab data is needed before any choice.")
        elif r["tool"] == "check_safety_rules":
            bad = [f for f in res["flags"] if f["status"] != "PASS"]
            lines.append(f"Safety screening overall: {res['overall']}. Reasons:")
            lines += [f"- {f['label']} ({f['status']}): {f['message']}" for f in bad[:8]]
        elif r["tool"] == "suggest_retests":
            lines.append("Suggested retests / confirmations:")
            lines += [f"- {x['test']}: {x['reason']}" for x in res["retests"][:6]]
        else:
            lines.append(f"- {r['tool']}: {summarize(r['tool'], res)}")
    lines += ["", "AI tools here do not certify food safety; confirmed accredited-lab results and human review are required."]
    return "\n".join(lines)


async def chat(message, session_id, sample_id, provider):
    run_id = db.new_id()
    hist = db.query("SELECT role, content FROM chat_messages WHERE session_id=? ORDER BY created_at DESC LIMIT 6", (session_id,))
    history = " | ".join(f"{h['role']}: {h['content'][:200]}" for h in reversed(hist))
    db.insert("chat_messages", {"id": db.new_id(), "session_id": session_id, "role": "user", "content": message, "created_at": db.now()})
    sid = _resolve(sample_id)["id"] if sample_id else None
    yield _ev(type="run", run_id=run_id, llm=llm_available())
    plan = None
    if llm_available():
        try:
            plan = await _llm_plan(message, sid, history, provider)
        except Exception:
            plan = None
    if not plan:
        plan = _keyword_plan(message, sid)
    _log(run_id, sid, 0, "plan", args={"question": message}, result={"plan": [p[0] for p in plan]},
         reasoning="Planned tool sequence for the user's question.")
    yield _ev(type="plan", steps=[{"tool": t, "args": a, "reason": w} for t, a, w in plan])
    results = []
    async for e in _execute(plan, run_id, sid, results):
        yield e
    prompt = (f"Conversation so far: {history}\nUser question: {message}\nTool results (JSON):\n{_compact(results)}\n\n"
              "Answer the question in under 220 words. Start with a one-line 'What I did:' listing the tools used, then the answer, "
              "then 'Next steps:'.")
    final_text = {}
    async for e in _draft(GUARDRAILS, prompt, provider, lambda: _fallback_answer(message, results), run_id, sid, len(plan) + 1):
        if '"type": "final"' in e:
            final_text["t"] = json.loads(e[6:])["text"]
        yield e
    db.insert("chat_messages", {"id": db.new_id(), "session_id": session_id, "role": "assistant",
                                "content": final_text.get("t", ""), "created_at": db.now()})
    review = False
    if sid:
        review = rules.build_report(sid)["human_review_required"]
    yield _ev(type="done", human_review_required=review)
