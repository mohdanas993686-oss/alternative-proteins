import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, LayoutGrid } from "lucide-react";
import { api, errMsg, BP } from "@/lib/api";
import { CardSkeleton, Note, DemoBadge } from "@/components/common";
import { ChartCard } from "@/components/ChartCard";
import FixFinder from "@/components/cost/FixFinder";
import { FixSheet } from "@/components/cost/FixDetail";
import { BeforeAfter, Sankey } from "@/components/cost/OutcomeCharts";
import { Waterfall, ScenarioCards } from "@/components/cost/CostCharts";
import { CostRace, VerdictCard } from "@/components/cost/Comparison";
import { CurrencySelect } from "@/lib/cost";

const STEPS = ["What is wrong", "What the fixes change", "Where the mass goes", "What it costs", "Three possible outcomes", "Against conventional proteins", "Verdict"];

const Dots = ({ i, setI }) => (
  <ol className="flex items-center gap-1.5" aria-label="Story progress">
    {STEPS.map((s, k) => <li key={s}><button data-testid={`story-dot-${k}`} aria-label={`Go to step ${k + 1}: ${s}`} aria-current={k === i ? "step" : undefined} onClick={() => setI(k)}
      className={`h-2 rounded-full transition-[width,background-color] duration-300 ${k === i ? "w-8 bg-primary" : k < i ? "w-2 bg-primary/50" : "w-2 bg-border"}`} /></li>)}
  </ol>
);

export default function StoryMode() {
  const [sp, setSp] = useSearchParams();
  const [samples, setSamples] = useState(null);
  const [cat, setCat] = useState(null);
  const [est, setEst] = useState(null);
  const [comp, setComp] = useState(null);
  const [err, setErr] = useState("");
  const [scenario, setScenario] = useState(null);
  const [metric, setMetric] = useState("per_kg_dig");
  const [hl, setHl] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [i, setI] = useState(0);
  useEffect(() => { api.get("/samples").then((r) => setSamples(r.data)); api.get("/fixes").then((r) => setCat(r.data)); api.post("/comparison", {}).then((r) => setComp(r.data)); }, []);
  const demo = samples?.find((s) => s.sample_code === "DEMO-FIX-01") || samples?.[0];
  const sid = sp.get("sample") || (!sp.get("bp") && demo?.id);
  const ctx = useMemo(() => (sid ? { sample_id: sid } : sp.get("bp") ? { byproduct: sp.get("bp") } : null), [sid, sp]);
  useEffect(() => {
    if (!ctx) return;
    setEst(null);
    api.post("/cost/estimate", { ...ctx, scenario }).then((r) => { setEst(r.data); setErr(""); }).catch((e) => setErr(errMsg(e)));
  }, [ctx, scenario]);
  const go = useCallback((d) => setI((x) => Math.min(STEPS.length - 1, Math.max(0, x + d))), []);
  useEffect(() => {
    const k = (e) => { if (e.target.closest("input,select,textarea")) return; if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [go]);
  const fmap = useMemo(() => Object.fromEntries((cat?.fixes || []).map((f) => [f.id, f])), [cat]);
  const pick = (v) => { setScenario(null); setSp(v.startsWith("bp:") ? { bp: v.slice(3) } : { sample: v.slice(7) }, { replace: true }); };

  const slide = () => {
    if (i <= 4 && (!est || !cat)) return <CardSkeleton rows={6} />;
    if (i >= 5 && !comp) return <CardSkeleton rows={6} />;
    switch (i) {
      case 0: return (
        <ChartCard id="story_fix_finder" eyebrow="Fix Finder" title={est.problems.length ? `${est.problems.length} problem(s) found; ${est.safety_block ? "a safety failure means divert or reject, human review required" : "each one has fix options"}` : "No problems detected: no corrective action needed"}>
          <FixFinder est={est} cat={fmap} stack={est.fixes_used} hl={hl} onHover={setHl} onPin={setPinned} />
        </ChartCard>);
      case 1: return <BeforeAfter est={est} />;
      case 2: return <Sankey est={est} which="mass" />;
      case 3: return <Waterfall est={est} />;
      case 4: return <ScenarioCards est={est} onPick={setScenario} />;
      case 5: return <CostRace items={comp.items} metric={metric} setMetric={setMetric} hl={hl} setHl={setHl} />;
      default: return <VerdictCard items={comp.items} metric={metric} caveat={comp.caveat} refKey={est?.profile.byproduct} />;
    }
  };

  return (
    <div data-testid="story-mode" className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to={`/hub${sid ? `?sample=${sid}` : ""}`} data-testid="story-back-hub" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><LayoutGrid className="h-4 w-4" /> Full hub</Link>
        <div className="flex flex-wrap items-center gap-2">
          {samples && <select data-testid="story-context-select" aria-label="Sample or by-product" value={sid ? `sample:${sid}` : `bp:${sp.get("bp")}`} onChange={(e) => pick(e.target.value)} className="field h-9 max-w-[260px] text-sm">
            <optgroup label="By-product (type average)">{Object.entries(BP).map(([k, v]) => <option key={k} value={`bp:${k}`}>{v.label}</option>)}</optgroup>
            <optgroup label="Samples">{samples.map((s) => <option key={s.id} value={`sample:${s.id}`}>{s.sample_code} · {s.byproduct_label}</option>)}</optgroup>
          </select>}
          <CurrencySelect />
        </div>
      </div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2"><span className="eyebrow">Story mode · step {i + 1} of {STEPS.length}</span><DemoBadge /></div>
          <h1 data-testid="story-step-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">{STEPS[i]}</h1>
          {est && <p className="mt-1 text-sm text-muted-foreground">{est.profile.label}</p>}
        </div>
        <Dots i={i} setI={setI} />
      </div>
      {err ? <Note tone="warn" testid="story-error">{err}</Note> : <div key={i} className="fade-up" data-testid={`story-slide-${i}`}>{slide()}</div>}
      <div className="mt-6 flex items-center justify-between gap-3">
        <button data-testid="story-prev-btn" disabled={i === 0} onClick={() => go(-1)} className="inline-flex h-10 items-center gap-1.5 rounded-full border bg-card px-5 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-40"><ArrowLeft className="h-4 w-4" /> Back</button>
        <span className="hidden text-xs text-muted-foreground sm:inline">Use ← → keys</span>
        {i < STEPS.length - 1
          ? <button data-testid="story-next-btn" onClick={() => go(1)} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5">Next: {STEPS[i + 1]} <ArrowRight className="h-4 w-4" /></button>
          : <Link data-testid="story-finish-btn" to={`/hub${sid ? `?sample=${sid}` : ""}`} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">Explore the full hub <ArrowRight className="h-4 w-4" /></Link>}
      </div>
      <FixSheet fix={pinned ? fmap[pinned] : null} all={cat?.fixes || []} onClose={() => setPinned(null)} />
    </div>
  );
}
