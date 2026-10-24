import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Presentation, FileDown, Scale, Filter } from "lucide-react";
import { api, API, BP } from "@/lib/api";
import { PageHeader, CardSkeleton, Note } from "@/components/common";
import Workspace, { useFocus } from "@/components/cost/Workspace";
import ComparisonSection from "@/components/cost/Comparison";
import AssumptionsSheet from "@/components/cost/Assumptions";
import { CurrencySelect } from "@/lib/cost";

const Sel = ({ label, value, onChange, children, testid }) => (
  <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs font-medium sm:flex-none"><span className="eyebrow">{label}</span>
    <select data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)} className="field h-9 text-sm">{children}</select></label>
);

export default function CostHub() {
  const [sp, setSp] = useSearchParams();
  const [samples, setSamples] = useState(null);
  const [comp, setComp] = useState(null);
  const [probs, setProbs] = useState({});
  const [est, setEst] = useState(null);
  const [rev, setRev] = useState(0);
  const focus = sp.get("focus");
  useEffect(() => { api.get("/samples").then((r) => setSamples(r.data)); api.get("/fixes").then((r) => setProbs(r.data.problems)); }, []);
  useEffect(() => { setComp(null); api.post("/comparison", {}).then((r) => setComp(r.data)); }, [rev]);
  const set = (k, v) => setSp((p) => { const n = new URLSearchParams(p); if (v === null || v === "" || v === "all" || v === "auto") n.delete(k); else n.set(k, v); n.delete("focus"); return n; }, { replace: true });
  const demo = samples?.find((s) => s.sample_code === "DEMO-FIX-01") || samples?.[0];
  const ctxVal = sp.get("sample") ? `sample:${sp.get("sample")}` : sp.get("bp") ? `bp:${sp.get("bp")}` : demo ? `sample:${demo.id}` : null;
  const ctx = useMemo(() => (!ctxVal ? null : ctxVal.startsWith("sample:") ? { sample_id: ctxVal.slice(7) } : { byproduct: ctxVal.slice(3) }), [ctxVal]);
  const setCtx = (v) => setSp((p) => { const n = new URLSearchParams(p); n.delete("sample"); n.delete("bp"); n.delete("focus"); n.delete("problem"); n.delete("scenario"); n.set(v.startsWith("sample:") ? "sample" : "bp", v.split(":")[1]); return n; }, { replace: true });
  const problem = sp.get("problem") || "all", scenario = sp.get("scenario") || "auto";
  const cfocus = useFocus(focus, !!comp);
  const detected = new Set((est?.problems || []).map((p) => p.problem));
  const pdf = est && `${API}/hub/pdf?${new URLSearchParams({ ...(ctx || {}), fixes: est.fixes_used.join(","), scenario: est.scenario, batch_kg: est.inputs.batch_kg, raw_price: est.inputs.raw_price, failure_prob: est.inputs.failure_prob, ...(Math.abs(est.inputs.yield_pct - est.inputs.default_yield_pct) > 0.01 ? { yield_pct: est.inputs.yield_pct } : {}) })}`;

  return (
    <div>
      <PageHeader eyebrow="Sections 10-13" title="Cost & Fix Hub" desc="Every fix, cost and comparison as a visual. Filters update all charts together."
        actions={<>
          <Link to={`/story${ctx?.sample_id ? `?sample=${ctx.sample_id}` : ""}`} data-testid="hub-story-btn" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"><Presentation className="h-4 w-4" /> Story mode</Link>
          {pdf && <a href={pdf} data-testid="hub-pdf-btn" className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-semibold hover:bg-accent"><FileDown className="h-4 w-4" /> Hub PDF</a>}
          <AssumptionsSheet onSaved={() => setRev((r) => r + 1)} />
          <CurrencySelect />
        </>} />
      <Note tone="warn" testid="hub-caveat">Cost is only one factor. Protein quality, taste, allergen status, regulatory approval and supply consistency also differ. All prices are editable placeholder assumptions.</Note>
      <div data-testid="hub-filter-bar" className="card-surface my-6 flex flex-wrap items-end gap-3 p-4">
        <Filter className="mb-2.5 hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden />
        {!samples ? <CardSkeleton rows={1} /> : <>
          <Sel label="By-product or sample" testid="hub-context-select" value={ctxVal || ""} onChange={setCtx}>
            <optgroup label="By-product (type average)">{Object.entries(BP).map(([k, v]) => <option key={k} value={`bp:${k}`}>{v.label}</option>)}</optgroup>
            <optgroup label="Samples">{samples.map((s) => <option key={s.id} value={`sample:${s.id}`}>{s.sample_code} · {s.byproduct_label} · {s.overall_status}</option>)}</optgroup>
          </Sel>
          <Sel label="Problem" testid="hub-problem-select" value={problem} onChange={(v) => set("problem", v)}>
            <option value="all">All problems</option>
            {Object.entries(probs).map(([k, p]) => <option key={k} value={k}>{p.label}{detected.has(k) ? " (detected)" : ""}</option>)}
          </Sel>
          <Sel label="Scenario" testid="hub-scenario-select" value={scenario} onChange={(v) => set("scenario", v)}>
            <option value="auto">Auto ({est?.auto_scenario || "…"})</option><option value="pass">Passes first time</option><option value="fixes">Needs fixes</option><option value="rejected">Rejected or diverted</option>
          </Sel>
          <Link to="/cost-comparison" data-testid="hub-reference-prices-link" className="mb-0.5 ml-auto inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold hover:bg-accent"><Scale className="h-4 w-4" /> Edit reference prices</Link>
        </>}
      </div>
      {ctx && <Workspace ctx={ctx} problem={problem} scenario={scenario} focus={focus} rev={rev} onEstimate={setEst} onScenario={(k) => set("scenario", k)} />}
      <div className="flex items-end gap-3 pb-2 pt-10"><span className="font-mono text-xs text-muted-foreground">04</span><h2 className="font-display text-2xl font-extrabold tracking-tight">Comparison with conventional proteins</h2></div>
      {!comp ? <CardSkeleton rows={5} /> : <ComparisonSection data={comp} refKey={est?.profile.byproduct} focused={(id) => cfocus === id} />}
    </div>
  );
}
