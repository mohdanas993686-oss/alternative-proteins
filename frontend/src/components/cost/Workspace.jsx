import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { CardSkeleton, Note } from "@/components/common";
import FixFinder from "@/components/cost/FixFinder";
import { FixSheet } from "@/components/cost/FixDetail";
import { FixHeatmap, FixBubble, FixRadar } from "@/components/cost/FixCharts";
import StackBuilder from "@/components/cost/StackBuilder";
import { BeforeAfter, Gauges, Timeline, Sankey } from "@/components/cost/OutcomeCharts";
import { Waterfall, Sunburst, ScenarioCards, WhatIf, Tornado, MonteCarlo, BatchCurve, BreakEvenChart } from "@/components/cost/CostCharts";
import { ChartCard } from "@/components/ChartCard";

const SectionTitle = ({ n, title, hint }) => (
  <div className="flex items-end gap-3 pt-4"><span className="font-mono text-xs text-muted-foreground">{n}</span><h2 className="font-display text-2xl font-extrabold tracking-tight">{title}</h2><span className="hidden pb-1 text-xs text-muted-foreground sm:inline">{hint}</span></div>
);

export function useFocus(focus, ready) {
  const [focused, setFocused] = useState(null);
  useEffect(() => {
    if (!focus || !ready) return;
    const t = setTimeout(() => { document.getElementById(`chart-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); setFocused(focus); }, 400);
    const u = setTimeout(() => setFocused(null), 4000);
    return () => { clearTimeout(t); clearTimeout(u); };
  }, [focus, ready]);
  return focused;
}

export default function Workspace({ ctx, problem = "all", scenario = "auto", focus, onEstimate, onScenario, rev: extRev = 0 }) {
  const [cat, setCat] = useState(null);
  const [stack, setStack] = useState(null);
  const [ov, setOv] = useState({});
  const [est, setEst] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hl, setHl] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [saved, setSaved] = useState([]);
  const [overlay, setOverlay] = useState([]);
  const rev = extRev;
  const [localProb, setLocalProb] = useState(null);
  const key = JSON.stringify(ctx);

  useEffect(() => { api.get("/fixes").then((r) => setCat(r.data)); }, [rev]);
  useEffect(() => { api.get("/cost/scenarios").then((r) => { setSaved(r.data); setOverlay(r.data.slice(0, 2).map((s) => s.id)); }); }, []);
  useEffect(() => { setStack(null); setOv({}); setEst(null); setLocalProb(null); }, [key]);
  useEffect(() => {
    if (!ctx.sample_id && !ctx.byproduct) return;
    setBusy(true);
    const body = { ...ctx, fixes: stack, overrides: ov, scenario: scenario === "auto" ? null : scenario };
    const t = setTimeout(() => api.post("/cost/estimate", body).then((r) => {
      setEst(r.data); setErr(""); onEstimate?.(r.data);
      if (stack === null) setStack(r.data.fixes_used);
    }).catch((e) => setErr(errMsg(e))).finally(() => setBusy(false)), stack === null ? 0 : 250);
    return () => clearTimeout(t);
  }, [key, JSON.stringify(stack), JSON.stringify(ov), scenario, rev]); // eslint-disable-line

  const focused = useFocus(focus, !!est && !!cat);
  const fixes = cat?.fixes || [];
  const fmap = useMemo(() => Object.fromEntries((cat?.fixes || []).map((f) => [f.id, f])), [cat]);

  if (err && !est) return <Note tone="warn" testid="workspace-error">{err}</Note>;
  if (!est || !cat) return <div className="grid gap-4"><CardSkeleton rows={6} /><CardSkeleton rows={4} /></div>;

  const bp = est.profile.byproduct;
  const nonSafety = est.problems.filter((p) => p.category !== "safety").map((p) => p.problem);
  const probKey = problem !== "all" ? problem : localProb || nonSafety[0] || est.problems[0]?.problem || "microbial";
  const toggle = (id) => setStack((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const F = (id) => focused === id;
  const picker = problem === "all" && (
    <label className="text-xs"><span className="sr-only">Problem for value charts</span>
      <select data-testid="bubble-problem-select" value={probKey} onChange={(e) => setLocalProb(e.target.value)} className="field h-8 max-w-[180px] text-xs">
        {Object.entries(cat.problems).map(([k, p]) => <option key={k} value={k}>{p.label}{nonSafety.includes(k) ? " (detected)" : ""}</option>)}
      </select></label>
  );
  const share = { hl, onHover: setHl, onPin: setPinned };
  const be = est.breakeven;

  return (
    <div data-testid="cost-workspace" className={`space-y-6 transition-opacity duration-300 ${busy ? "opacity-80" : ""}`}>
      {busy && <span className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs shadow-lg"><Loader2 className="h-3.5 w-3.5 animate-spin" /> updating charts</span>}
      {err && <Note tone="warn">{err}</Note>}
      {est.safety_block && <p data-testid="safety-block-banner" className="flex items-center gap-2 rounded-2xl border border-rose-600/30 bg-rose-500/10 p-3 text-sm font-semibold text-rose-900 dark:text-rose-200"><AlertTriangle className="h-4 w-4" /> Safety failure: divert or reject, human review required. No fix makes this batch safe.</p>}

      <SectionTitle n="01" title="Fix" hint="problem → fix options → outcome" />
      <ChartCard id="fix_finder" eyebrow="Fix Finder" focused={F("fix_finder")}
        title={est.problems.length ? `${est.problems.length} problem(s) found: ${est.problems.filter((p) => p.category === "safety").length ? "safety failures end in divert or reject" : "every branch has a fix option"}; click a fix for details` : "No problems detected: no corrective action needed"}
        data={{ columns: ["Problem", "Status", "Fix options"], rows: est.problems.map((p) => [p.label, p.status, (est.options[p.problem] || []).map((i) => fmap[i]?.action).join(" | ")]) }}>
        <FixFinder est={est} cat={fmap} problemFilter={problem} stack={stack || []} {...share} />
      </ChartCard>
      <FixHeatmap fixes={fixes} problems={cat.problems} bp={bp} problem={problem} {...share} focused={F("heatmap")} />
      <div className="grid gap-6 xl:grid-cols-2">
        <FixBubble fixes={fixes} problems={cat.problems} bp={bp} problemKey={probKey} picker={picker} {...share} focused={F("bubble")} />
        <FixRadar fixes={fixes} bp={bp} problemKey={probKey} stack={stack || []} hl={hl} focused={F("fix_radar")} />
      </div>
      <StackBuilder est={est} fixes={fixes} stack={stack || []} setStack={setStack} problemFilter={problem} {...share} focused={F("stack")} />

      <SectionTitle n="02" title="Outcome" hint="projected, not measured" />
      <div className="grid gap-6 xl:grid-cols-2">
        <BeforeAfter est={est} focused={F("before_after")} />
        <div className="space-y-6"><Gauges est={est} focused={F("gauges")} /><Timeline est={est} hl={hl} focused={F("timeline")} /></div>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Sankey est={est} which="mass" focused={F("sankey_mass")} />
        <Sankey est={est} which="protein" focused={F("sankey_protein")} />
      </div>

      <SectionTitle n="03" title="Cost" hint="placeholder INR assumptions" />
      <WhatIf est={est} ctx={ctx} ov={ov} setOv={setOv} stack={stack || []} saved={saved} setSaved={setSaved} overlay={overlay} setOverlay={setOverlay} focused={F("whatif")} />
      <ScenarioCards est={est} onPick={onScenario} focused={F("scenarios")} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Waterfall est={est} focused={F("waterfall")} />
        <Sunburst est={est} focused={F("sunburst")} />
        <Tornado est={est} focused={F("tornado")} />
        <MonteCarlo est={est} saved={saved} overlay={overlay} focused={F("monte_carlo")} />
        <BatchCurve est={est} saved={saved} overlay={overlay} focused={F("batch_curve")} />
        {be && <BreakEvenChart id="breakeven_sample" line={{ ...be, name: est.profile.label.split(" (")[0], raw_typical: be.raw_typical }}
          sources={be.rows.map((r) => ({ name: r.name, target: r.target_per_kg_dig }))} focused={F("breakeven_sample")} />}
      </div>
      <FixSheet fix={pinned ? fmap[pinned] : null} all={fixes} stack={stack || []} onToggle={toggle} onClose={() => setPinned(null)} />
    </div>
  );
}
