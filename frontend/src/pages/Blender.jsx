import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Scale, Loader2, AlertTriangle } from "lucide-react";
import { api, errMsg, fmt } from "@/lib/api";
import { PageHeader, Section, CardSkeleton, StatusBadge, Note, Term, Empty } from "@/components/common";
import { Plot } from "@/components/Charts";

const SHARE_KEYS = [["protein", "Protein"], ["oil", "Oil"], ["fibre_total", "Fibre"], ["phytate", "Phytate"], ["tannins", "Tannins"], ["trypsin_inhibitor", "Trypsin inhibitor"]];
const PALETTE = ["#15803d", "#b45309", "#0369a1", "#9a5b3c", "#7c3aed"];

const ComponentRow = ({ c, i, sources, used, onChange, onRemove, canRemove }) => (
  <div data-testid={`blend-component-${i}`} className="fade-up space-y-3 rounded-xl border bg-background/60 p-4">
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: PALETTE[i] }} aria-hidden />
      <select data-testid={`blend-source-select-${i}`} aria-label={`Component ${i + 1} source`} value={c.source_id} onChange={(e) => onChange({ source_id: e.target.value })} className="field">
        <optgroup label="By-product averages">{sources.filter((s) => s.kind === "byproduct").map((s) => <option key={s.id} value={s.id} disabled={used.has(s.id) && s.id !== c.source_id}>{s.label} · n={s.n_samples}</option>)}</optgroup>
        <optgroup label="Individual samples">{sources.filter((s) => s.kind === "sample").map((s) => <option key={s.id} value={s.id} disabled={used.has(s.id) && s.id !== c.source_id}>{s.label} · {s.status}</option>)}</optgroup>
      </select>
      <button data-testid={`blend-remove-${i}`} onClick={onRemove} disabled={!canRemove} aria-label={`Remove component ${i + 1}`} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-accent hover:text-destructive disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
    </div>
    <div className="flex items-center gap-3">
      <input data-testid={`blend-slider-${i}`} type="range" min={0} max={100} step={1} value={c.percent} onChange={(e) => onChange({ percent: Number(e.target.value) })} aria-label={`Component ${i + 1} percent`} className="w-full accent-primary" />
      <label className="flex items-center gap-1"><span className="sr-only">Percent</span>
        <input data-testid={`blend-percent-${i}`} type="number" min={0} max={100} step="0.5" value={c.percent} onChange={(e) => onChange({ percent: e.target.value === "" ? 0 : Number(e.target.value) })} className="field h-9 w-20 text-right font-mono" />
        <span className="text-sm text-muted-foreground">%</span></label>
    </div>
  </div>
);

const ResultCards = ({ r }) => (
  <div className="grid gap-4 sm:grid-cols-3">
    <div className="rounded-xl border p-4"><p className="eyebrow">Blend score</p><p data-testid="blend-score" className="font-display text-5xl font-extrabold leading-tight">{r.suitability.score}<span className="text-base text-muted-foreground">/100</span></p><p className="text-xs text-muted-foreground">base {r.suitability.base_score} × safety {r.suitability.safety_multiplier}</p></div>
    <div className="rounded-xl border p-4"><p className="eyebrow">Usable protein (safety-adjusted)</p><p data-testid="blend-usable-protein" className="font-display text-3xl font-extrabold">{r.suitability.usable_protein_g_per_kg}<span className="text-base text-muted-foreground"> g/kg</span></p></div>
    <div className="rounded-xl border p-4"><p className="eyebrow mb-2">Worst component status</p><StatusBadge status={r.status} testid="blend-status" /><p className="mt-2 text-xs text-muted-foreground">Allergens: <span data-testid="blend-allergens" className="font-semibold text-foreground">{r.allergens.length ? r.allergens.join(", ") : "none inherent"}</span></p></div>
  </div>
);

const BlendTable = ({ r }) => (
  <div className="overflow-x-auto">
    <table data-testid="blend-composition-table" className="w-full min-w-[560px] text-sm">
      <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Target</th><th>Blend</th>{r.components.map((c, i) => <th key={c.source_id}><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i] }} />{c.percent}%</span></th>)}</tr></thead>
      <tbody className="divide-y">{[...r.composition, ...r.anf].map((v) => (
        <tr key={v.key} data-testid={`blend-row-${v.key}`}><td className="py-2 font-medium">{v.label} <span className="text-xs text-muted-foreground">{v.unit}</span></td><td className="font-mono font-semibold">{fmt(v.value, 2)}</td>
          {r.components.map((c) => <td key={c.source_id} className="font-mono text-xs text-muted-foreground">{fmt(c.values[v.key], 2)}</td>)}</tr>
      ))}</tbody>
    </table>
  </div>
);

export default function Blender() {
  const [sources, setSources] = useState(null);
  const [comps, setComps] = useState([]);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/blend/sources").then((r) => {
      setSources(r.data);
      setComps([{ source_id: "type:guar_meal", percent: 60 }, { source_id: "type:pulse_residue", percent: 40 }]);
    });
  }, []);

  const total = comps.reduce((s, c) => s + (Number(c.percent) || 0), 0);
  const used = useMemo(() => new Set(comps.map((c) => c.source_id)), [comps]);
  const valid = comps.length >= 2 && Math.abs(total - 100) <= 0.5 && comps.every((c) => c.percent > 0);

  useEffect(() => {
    if (!sources) return;
    if (!valid) { setErr(comps.some((c) => !(c.percent > 0)) ? "Every component needs more than 0%." : `Percentages add up to ${fmt(total, 1)}%: they must total 100%.`); return; }
    setErr(""); setBusy(true);
    const t = setTimeout(() => api.post("/blend", { components: comps }).then((r) => setRes(r.data)).catch((e) => setErr(errMsg(e))).finally(() => setBusy(false)), 300);
    return () => { clearTimeout(t); setBusy(false); };
  }, [comps, sources]); // eslint-disable-line

  const update = (i, patch) => setComps((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const add = () => { const next = sources.find((s) => !used.has(s.id)); if (next) setComps((cs) => [...cs, { source_id: next.id, percent: 0 }]); };
  const normalise = () => { if (!total) return; setComps((cs) => { const n = cs.map((c) => ({ ...c, percent: Math.round((c.percent / total) * 1000) / 10 })); const d = Math.round((100 - n.reduce((s, c) => s + c.percent, 0)) * 10) / 10; n[0].percent = Math.round((n[0].percent + d) * 10) / 10; return n; }); };
  const even = () => setComps((cs) => cs.map((c, i) => ({ ...c, percent: i === 0 ? Math.round((100 - Math.floor(1000 / cs.length) / 10 * (cs.length - 1)) * 10) / 10 : Math.floor(1000 / cs.length) / 10 })));

  return (
    <div>
      <PageHeader eyebrow="Formulation" title="Blender" desc="Mix 2 to 5 by-products (type averages or individual samples) and see the theoretical blended protein, fibre, oil and anti-nutrient profile." />
      {!sources ? <CardSkeleton rows={5} /> : sources.length === 0 ? <Empty title="No samples to blend" hint="Add samples first via New analysis." /> : (
        <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
          <div className="space-y-4 xl:sticky xl:top-36 xl:self-start">
            <Section testid="blend-components-section" eyebrow="Recipe" title="Components" right={<span data-testid="blend-total" className={`rounded-full px-3 py-1 font-mono text-sm font-bold ${Math.abs(total - 100) <= 0.5 ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" : "bg-rose-500/15 text-rose-800 dark:text-rose-300"}`}>{fmt(total, 1)}%</span>}>
              <div className="space-y-3">
                {comps.map((c, i) => <ComponentRow key={i} c={c} i={i} sources={sources} used={used} onChange={(p) => update(i, p)} onRemove={() => setComps((cs) => cs.filter((_, j) => j !== i))} canRemove={comps.length > 2} />)}
              </div>
              {err && <p data-testid="blend-error" role="alert" className="mt-3 flex items-center gap-1.5 text-xs font-medium text-destructive"><AlertTriangle className="h-3.5 w-3.5" />{err}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <button data-testid="blend-add-btn" onClick={add} disabled={comps.length >= 5} className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50"><Plus className="h-4 w-4" /> Add component</button>
                <button data-testid="blend-normalise-btn" onClick={normalise} className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent"><Scale className="h-4 w-4" /> Scale to 100%</button>
                <button data-testid="blend-even-btn" onClick={even} className="rounded-full border px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent">Equal split</button>
              </div>
            </Section>
            <Note tone="warn" testid="blend-disclaimer">Theoretical blend calculated from DEMO DATA. It is not a tested formulation and is not certified safe.</Note>
          </div>

          <div className="space-y-6">
            {!res ? <CardSkeleton rows={4} /> : (
              <div className={`space-y-6 transition-opacity duration-300 ${busy || err ? "opacity-60" : ""}`}>
                <Section testid="blend-result-section" eyebrow="Result" title="Blended profile" right={busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}>
                  <ResultCards r={res} />
                  <ul className="mt-4 space-y-1.5">{res.notes.map((n) => <li key={n} className="flex gap-2 text-xs text-muted-foreground"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />{n}</li>)}</ul>
                </Section>
                <div className="grid gap-6 2xl:grid-cols-2">
                  <Section testid="blend-contribution-section" eyebrow="Contribution" title="Where each nutrient comes from">
                    <Plot testid="blend-contribution-chart" height={320} data={res.components.map((c, i) => ({
                      type: "bar", orientation: "h", name: `${c.label} (${c.percent}%)`, marker: { color: PALETTE[i] },
                      y: SHARE_KEYS.filter(([k]) => res.contribution_shares[k]).map(([, l]) => l),
                      x: SHARE_KEYS.filter(([k]) => res.contribution_shares[k]).map(([k]) => res.contribution_shares[k][i]),
                      hovertemplate: "%{y}: %{x:.1f}%<extra>" + c.label + "</extra>",
                    }))} layout={{ barmode: "stack", xaxis: { title: { text: "Share of blend total (%)" }, range: [0, 100] }, margin: { l: 110, r: 10, t: 10, b: 50 }, legend: { orientation: "h", y: -0.3 } }} />
                  </Section>
                  <Section testid="blend-score-compare-section" eyebrow="Benchmark" title="Blend vs components (score)">
                    <Plot testid="blend-score-chart" height={320} data={[{
                      type: "bar", x: [...res.components.map((c) => c.label.replace(" (average)", " avg")), "Blend"], y: [...res.components.map((c) => c.score), res.suitability.score],
                      marker: { color: [...res.components.map((_, i) => PALETTE[i]), "#1f4d36"], line: { width: [...res.components.map(() => 0), 2], color: "#e7b416" } },
                      text: [...res.components.map((c) => c.status), res.status], textposition: "outside", hovertemplate: "%{x}: %{y:.1f}<extra></extra>",
                    }]} layout={{ yaxis: { title: { text: "Suitability score" }, range: [0, 100] }, showlegend: false, margin: { l: 52, r: 10, t: 10, b: 90 } }} />
                  </Section>
                </div>
                <Section testid="blend-table-section" eyebrow="Detail" title={<>Blend vs components (dry-matter basis, <Term k="ANF">ANF</Term> included)</>}>
                  <BlendTable r={res} />
                  <p className="mt-3 text-xs text-muted-foreground">Moisture is blended by mass. Other values are weighted by each component's dry matter: Σ(% × (1 − moisture) × value) ÷ Σ(% × (1 − moisture)). Residual gum counts as 0 for by-products without it.</p>
                </Section>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


