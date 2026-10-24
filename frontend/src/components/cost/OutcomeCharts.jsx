import { Check, X, ShieldAlert } from "lucide-react";
import { Plot } from "@/components/Charts";
import { ChartCard } from "@/components/ChartCard";
import { useMoney, pct, kg, short } from "@/lib/cost";

const fmtv = (v) => (v >= 1000 ? Math.round(v).toLocaleString() : v >= 10 ? v.toFixed(1) : v.toFixed(2));

const PairRow = ({ p }) => {
  const f = (x) => (p.log ? Math.log10(Math.max(x, 1)) : x);
  const mx = Math.max(f(p.before), f(p.after), f(p.limit)) * 1.15 || 1;
  const w = (x) => `${(f(x) / mx) * 100}%`;
  const ok = p.pass_after;
  return (
    <li data-testid={`pair-${p.key}`} className="grid grid-cols-[120px_1fr_92px] items-center gap-3 py-1.5 sm:grid-cols-[150px_1fr_110px]">
      <span className="text-xs font-medium leading-tight">{p.label}<span className="block text-[10px] text-muted-foreground">{p.unit}{p.log ? " · log scale" : ""}</span></span>
      <div className="relative space-y-1">
        <div className="h-2.5 rounded-full bg-stone-400/70 transition-[width] duration-700" style={{ width: w(p.before) }} title={`Before ${fmtv(p.before)}`} />
        <div className={`h-2.5 rounded-full transition-[width] duration-700 ${ok ? "bg-emerald-600" : "bg-rose-600 bg-[repeating-linear-gradient(45deg,transparent_0_4px,rgba(255,255,255,.35)_4px_7px)]"}`} style={{ width: w(p.after) }} title={`After ${fmtv(p.after)}`} />
        <span className="absolute -bottom-1 -top-1 border-l-2 border-dashed border-foreground/70" style={{ left: w(p.limit) }} aria-hidden />
      </div>
      <span className={`flex items-center justify-end gap-1 text-right font-mono text-[11px] ${ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>
        {ok ? <Check className="h-3.5 w-3.5" aria-label="within limit" /> : <X className="h-3.5 w-3.5" aria-label="outside limit" />}{fmtv(p.before)}→{fmtv(p.after)}
      </span>
      {p.note && <span className="col-span-3 -mt-1 flex items-center gap-1 text-[10.5px] font-semibold text-rose-700 dark:text-rose-400"><ShieldAlert className="h-3 w-3" />{p.note}</span>}
    </li>
  );
};

export const PairedBars = ({ items, testid = "paired-bars" }) => (
  <div data-testid={testid}>
    <ul className="divide-y divide-border/60">{items.map((p) => <PairRow key={p.key} p={p} />)}</ul>
    <p className="mt-2 flex flex-wrap gap-3 text-[10.5px] text-muted-foreground"><span className="flex items-center gap-1"><span className="h-2 w-4 rounded bg-stone-400/70" />before</span><span className="flex items-center gap-1"><span className="h-2 w-4 rounded bg-emerald-600" />after, within limit</span><span className="flex items-center gap-1"><span className="h-2 w-4 rounded bg-rose-600" />after, outside limit</span><span className="flex items-center gap-1"><span className="h-3 border-l-2 border-dashed border-foreground/70" />placeholder limit</span></p>
  </div>
);

export function BeforeAfter({ est, focused }) {
  const ba = est.before_after;
  const failing = ba.filter((p) => !p.pass_before);
  const crossed = failing.filter((p) => p.pass_after);
  const title = !failing.length ? "All measured parameters are already within placeholder limits"
    : `${crossed.length} of ${failing.length} failing parameters move inside the limit after the fixes (projected), ready to retest`;
  return (
    <ChartCard id="before_after" eyebrow="Before vs after" title={title} projected focused={focused}
      data={{ columns: ["Parameter", "Unit", "Before", "After (projected)", "Limit", "Within limit after"], rows: ba.map((p) => [p.label, p.unit, p.before, p.after, p.limit, p.pass_after ? "yes" : "no"]) }}>
      <PairedBars items={ba} />
    </ChartCard>
  );
}

const Gauge = ({ title, value, ref0, range, suffix, lowerBetter, testid, threshold }) => (
  <Plot testid={testid} height={180} data={[{ type: "indicator", mode: "gauge+number+delta", value, title: { text: title, font: { size: 12 } },
    number: { suffix, font: { size: 22 }, valueformat: ",.0f" }, delta: { reference: ref0, valueformat: ",.0f", increasing: { color: lowerBetter ? "#b91c1c" : "#15803d" }, decreasing: { color: lowerBetter ? "#15803d" : "#b91c1c" } },
    gauge: { axis: { range }, bar: { color: "#1f4d36" }, steps: [{ range: [range[0], ref0], color: "rgba(168,162,158,.25)" }], threshold: threshold != null ? { line: { color: "#e7b416", width: 3 }, value: threshold } : undefined } }]}
    layout={{ margin: { l: 22, r: 22, t: 40, b: 8 }, transition: { duration: 600 } }} />
);

export function Gauges({ est, focused }) {
  const { conv, money, sym } = useMoney();
  const a = est.metrics.fixes, b = est.metrics.pass;
  const pb = est.values_before.protein, pa = est.values_after.protein;
  const cd = conv(a.per_kg_dig), cb = conv(b.per_kg_dig);
  return (
    <ChartCard id="gauges" eyebrow="Key metrics" projected cost focused={focused}
      title={`Projected: protein ${pb?.toFixed(0)}→${pa?.toFixed(0)}% DM, yield ${a.mass_yield_pct.toFixed(0)}%, ${money(a.per_kg_dig)}/kg digestible protein`}
      data={{ columns: ["Metric", "Before / as-is", "After (projected)"], rows: [["Protein % DM", pb, pa], ["Usable protein g/kg", b.usable_protein_g_per_kg, a.usable_protein_g_per_kg], ["Cost per kg digestible protein (INR)", b.per_kg_dig, a.per_kg_dig], ["Mass yield %", b.mass_yield_pct, a.mass_yield_pct]] }}>
      <div className="grid grid-cols-2 gap-2">
        <Gauge testid="gauge-protein" title="Protein (% DM)" value={pa} ref0={pb} range={[0, 100]} suffix="%" threshold={40} />
        <Gauge testid="gauge-usable" title="Usable protein (g/kg)" value={a.usable_protein_g_per_kg} ref0={b.usable_protein_g_per_kg} range={[0, 900]} />
        <Gauge testid="gauge-cost" title={`${sym}/kg digestible protein`} value={cd} ref0={cb} range={[0, Math.max(cd, cb) * 1.6]} lowerBetter />
        <Gauge testid="gauge-yield" title="Mass yield (%)" value={a.mass_yield_pct} ref0={b.mass_yield_pct} range={[0, 100]} suffix="%" />
      </div>
    </ChartCard>
  );
}

const KIND = { fix: ["#15803d", "Fix step"], retest: ["#d97706", "Independent retest (mandatory gate)"], review: ["#be123c", "Human review"], decision: ["#7f1d1d", "Decision"] };

export function Timeline({ est, hl, focused }) {
  const t = est.timeline;
  const end = t[t.length - 1]?.end || 0;
  const gate = t.find((x) => x.kind === "retest");
  const title = est.safety_block && !gate ? `About ${Math.ceil(end / 24)} days to a documented divert-or-reject decision; human review is mandatory`
    : `About ${Math.ceil(end / 24)} days from first fix to human re-review; the independent retest is a mandatory gate`;
  return (
    <ChartCard id="timeline" eyebrow="Status timeline" title={title} focused={focused}
      data={{ columns: ["Task", "Start h", "End h", "Mandatory"], rows: t.map((x) => [x.task, x.start, x.end, x.mandatory ? "yes" : "no"]) }}>
      <Plot testid="timeline-plot" height={Math.max(220, t.length * 42 + 80)}
        data={Object.entries(KIND).map(([k, [c, n]]) => { const xs = t.filter((x) => x.kind === k); return {
          type: "bar", orientation: "h", name: n, y: xs.map((x) => x.task), x: xs.map((x) => Math.max(x.end - x.start, 0.5)), base: xs.map((x) => x.start),
          marker: { color: c, line: { width: xs.map((x) => (hl && x.fix_id === hl ? 3 : 0)), color: "#e7b416" }, pattern: { shape: k === "retest" ? "/" : k === "review" ? "." : "" } },
          hovertemplate: "%{y}<br>%{base:.0f} h → %{x:.0f} h duration<extra></extra>" }; }).filter((tr) => tr.y.length)}
        layout={{ barmode: "overlay", yaxis: { autorange: "reversed", automargin: true, categoryorder: "array", categoryarray: t.map((x) => x.task) }, xaxis: { title: { text: "Hours from start" } }, margin: { l: 10, r: 10, t: 10, b: 60 },
          shapes: gate ? [{ type: "line", x0: gate.end, x1: gate.end, yref: "paper", y0: 0, y1: 1, line: { color: "#d97706", dash: "dash", width: 2 } }] : [],
          annotations: gate ? [{ x: gate.end, yref: "paper", y: 1.06, text: "◆ mandatory safety gate", showarrow: false, font: { size: 10, color: "#b45309" } }] : [] }} />
    </ChartCard>
  );
}

const NODE_C = { main: "#1f4d36", step: "#15803d", side: "#d97706", product: "#0f766e", reject: "#b91c1c" };

export function Sankey({ est, which = "mass", focused }) {
  const s = which === "mass" ? est.sankey_mass : est.sankey_protein;
  const unit = which === "mass" ? "kg" : "kg protein";
  const prodLink = s.links[s.links.length - 1];
  const side = s.links.filter((l) => s.nodes[l.target].kind === "side").sort((a, b) => b.value - a.value)[0];
  const start = s.links[0]?.value || 0;
  const rej = s.nodes.some((n) => n.kind === "reject");
  const title = rej ? `All ${kg(start)} ${which === "mass" ? "" : "of protein "}leaves the food chain: divert or reject after human review`
    : which === "mass" ? `${kg(prodLink.value)} of ${kg(start)} becomes product (${pct((prodLink.value / start) * 100)})${side ? `; biggest loss: ${s.nodes[side.target].label.toLowerCase()} (${kg(side.value)})` : ""}`
      : `${pct((prodLink.value / start) * 100)} of the protein is retained${side ? `; ${s.nodes[side.target].label.toLowerCase()} takes the most (${side.value.toFixed(1)} kg)` : ""}`;
  return (
    <ChartCard id={which === "mass" ? "sankey_mass" : "sankey_protein"} eyebrow={which === "mass" ? "Mass flow" : "Protein flow"} title={title} projected focused={focused}
      data={{ columns: ["From", "To", `Amount (${unit})`], rows: s.links.map((l) => [s.nodes[l.source].label, s.nodes[l.target].label, l.value.toFixed(1)]) }}>
      <Plot testid={`sankey-${which}`} height={330} data={[{ type: "sankey", arrangement: "snap", valueformat: ",.1f", valuesuffix: ` ${unit}`,
        node: { label: s.nodes.map((n) => short(n.label, 22)), customdata: s.nodes.map((n) => n.label), hovertemplate: `%{customdata}<br>%{value:,.1f} ${unit}<extra></extra>`, color: s.nodes.map((n) => NODE_C[n.kind]), pad: 14, thickness: 16, line: { width: 0 } },
        link: { source: s.links.map((l) => l.source), target: s.links.map((l) => l.target), value: s.links.map((l) => l.value),
          color: s.links.map((l) => ({ side: "rgba(217,119,6,.35)", reject: "rgba(185,28,28,.35)" }[s.nodes[l.target].kind] || "rgba(21,128,61,.28)")) } }]}
        layout={{ margin: { l: 8, r: 8, t: 8, b: 8 } }} />
    </ChartCard>
  );
}
