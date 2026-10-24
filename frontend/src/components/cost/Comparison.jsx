import { useEffect, useMemo, useState } from "react";
import { Play, Pause, Sprout, Factory, Trophy, Check, X, Equal, Medal } from "lucide-react";
import { Plot } from "@/components/Charts";
import { ChartCard, IllustrativeBadge } from "@/components/ChartCard";
import { BreakEvenChart } from "@/components/cost/CostCharts";
import { BP } from "@/lib/api";
import { METRICS, relation, median, useMoney, short } from "@/lib/cost";

const colorOf = (i) => (i.kind === "byproduct" ? BP[i.key]?.color || "#15803d" : "#475569");
const STRIPES = "repeating-linear-gradient(135deg, rgba(255,255,255,.28) 0 5px, transparent 5px 10px)";
const REL = { cheaper: ["#15803d", Check, "cheaper"], comparable: ["#b45309", Equal, "comparable"], "more expensive": ["#b91c1c", X, "more expensive"] };
const ROW = 46;

const MetricSwitch = ({ metric, setMetric }) => (
  <div role="radiogroup" aria-label="Cost metric" className="flex flex-wrap gap-1 rounded-full border bg-background p-1">
    {METRICS.map(([k, l]) => <button key={k} role="radio" aria-checked={metric === k} data-testid={`metric-${k}`} onClick={() => setMetric(k)}
      className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${metric === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>)}
  </div>
);

export function CostRace({ items, metric, setMetric, hl, setHl, focused }) {
  const { money } = useMoney();
  const [play, setPlay] = useState(false);
  const [grown, setGrown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGrown(true), 80); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!play) return;
    const t = setInterval(() => setMetric((m) => METRICS[(METRICS.findIndex(([k]) => k === m) + 1) % METRICS.length][0]), 1800);
    return () => clearInterval(t);
  }, [play, setMetric]);
  const sorted = [...items].sort((a, b) => a[metric].typical - b[metric].typical);
  const rank = Object.fromEntries(sorted.map((i, k) => [i.key, k]));
  const max = Math.max(...items.map((i) => i[metric].high));
  const label = METRICS.find(([k]) => k === metric)[1];
  return (
    <ChartCard id="cost_race" eyebrow="Cost race" cost focused={focused}
      title={`Per ${label.replace("per ", "")}: ${sorted[0].name} leads at ${money(sorted[0][metric].typical)}; ${sorted[sorted.length - 1].name} trails at ${money(sorted[sorted.length - 1][metric].typical)}`}
      data={{ columns: ["Rank", "Source", "Type", `Low (INR ${label})`, "Typical", "High"], rows: sorted.map((i, k) => [k + 1, i.name, i.kind, i[metric].low, i[metric].typical, i[metric].high]) }}
      right={<button data-testid="race-play-btn" onClick={() => setPlay((p) => !p)} className="inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-semibold hover:bg-accent">{play ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{play ? "Pause" : "Play race"}</button>}>
      <div className="mb-4"><MetricSwitch metric={metric} setMetric={setMetric} /></div>
      <div className="relative" style={{ height: items.length * ROW }} data-testid="race-chart">
        {items.map((i) => {
          const m = i[metric];
          const c = colorOf(i);
          return (
            <div key={i.key} data-testid={`race-row-${i.key}`} onMouseEnter={() => setHl(i.key)} onMouseLeave={() => setHl(null)}
              className={`absolute inset-x-0 grid grid-cols-[150px_1fr] items-center gap-3 rounded-lg px-1 transition-[top,opacity] duration-700 ease-out sm:grid-cols-[230px_1fr] ${hl && hl !== i.key ? "opacity-40" : ""}`} style={{ top: rank[i.key] * ROW, height: ROW - 6 }}>
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold"><span className="w-5 font-mono text-muted-foreground">{rank[i.key] + 1}</span>
                {i.kind === "byproduct" ? <Sprout className="h-3.5 w-3.5 shrink-0" style={{ color: c }} aria-label="by-product" /> : <Factory className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-label="conventional" />}
                <span className="truncate">{i.name}</span></span>
              <div className="relative h-6">
                <div className="absolute inset-y-0 left-0 rounded-md transition-[width] duration-700 ease-out" style={{ width: grown ? `${(m.typical / max) * 100}%` : 0, background: c, backgroundImage: i.kind === "conventional" ? STRIPES : undefined }} />
                <div className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-foreground/60 transition-all duration-700" style={{ left: `${(m.low / max) * 100}%`, width: `${((m.high - m.low) / max) * 100}%` }} aria-hidden />
                <span className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-foreground/60 transition-all duration-700" style={{ left: `${(m.low / max) * 100}%` }} aria-hidden />
                <span className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-foreground/60 transition-all duration-700" style={{ left: `${(m.high / max) * 100}%` }} aria-hidden />
                <span className="absolute top-1/2 -translate-y-1/2 pl-2 font-mono text-[11px] font-semibold transition-all duration-700" style={{ left: `${Math.min((m.high / max) * 100, 78)}%` }}>{money(m.typical)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Solid = by-product (after the chosen fixes) · striped = conventional source · whisker = low–high range.</p>
    </ChartCard>
  );
}

export function RangeBars({ items, metric, refKey, hl, setHl, onPin, focused }) {
  const { conv, money, sym } = useMoney();
  const ref = items.find((i) => i.key === refKey) || items[0];
  const sorted = [...items].sort((a, b) => b[metric].typical - a[metric].typical);
  const rel = (i) => (i.key === ref.key ? "reference" : relation(i[metric], ref[metric]));
  const comp = items.filter((i) => i.key !== ref.key && rel(i) === "comparable");
  const label = METRICS.find(([k]) => k === metric)[1];
  const col = { reference: "#1f4d36", cheaper: "#15803d", comparable: "#b45309", "more expensive": "#b91c1c" };
  return (
    <ChartCard id="range_bars" eyebrow="Uncertainty ranges" cost focused={focused}
      title={`${comp.length} source(s) overlap with ${ref.name.toLowerCase()}: comparable, not cheaper (${label})`}
      data={{ columns: ["Source", "Low", "Typical", "High", `Relation to ${ref.name}`], rows: sorted.map((i) => [i.name, i[metric].low, i[metric].typical, i[metric].high, rel(i)]) }}>
      <Plot testid="range-plot" height={Math.max(320, items.length * 32 + 90)}
        onHover={(e) => setHl(e?.points?.[0]?.customdata || null)} onUnhover={() => setHl(null)} onClick={(e) => e?.points?.[0]?.customdata && onPin?.(e.points[0].customdata)}
        data={[{ type: "bar", orientation: "h", y: sorted.map((i) => i.name), base: sorted.map((i) => conv(i[metric].low)), x: sorted.map((i) => conv(i[metric].high - i[metric].low)), customdata: sorted.map((i) => i.key),
          marker: { color: sorted.map((i) => col[rel(i)]), opacity: sorted.map((i) => (!hl || hl === i.key ? 0.85 : 0.3)), pattern: { shape: sorted.map((i) => ({ comparable: "/", "more expensive": "x", cheaper: "", reference: "." }[rel(i)])) } },
          text: sorted.map((i) => rel(i)), textposition: "outside", textfont: { size: 10 }, hovertext: sorted.map((i) => `${money(i[metric].low)} – ${money(i[metric].high)}`), hovertemplate: "%{y}<br>%{hovertext}<extra></extra>" },
        { type: "scatter", mode: "markers", y: sorted.map((i) => i.name), x: sorted.map((i) => conv(i[metric].typical)), marker: { symbol: "line-ns-open", size: 18, color: "#1c2b22", line: { width: 2.5 } }, hoverinfo: "skip" }]}
        layout={{ showlegend: false, xaxis: { title: { text: `${sym} ${label}` } }, yaxis: { automargin: true }, margin: { l: 10, r: 80, t: 10, b: 50 }, transition: { duration: 500 },
          shapes: [{ type: "rect", yref: "paper", y0: 0, y1: 1, x0: conv(ref[metric].low), x1: conv(ref[metric].high), fillcolor: "rgba(31,77,54,.08)", line: { width: 0 }, layer: "below" }] }} />
      <p className="text-[11px] text-muted-foreground">Shaded band = reference range. Overlap = "comparable"; "cheaper" only when ranges do not overlap. Tick = typical value.</p>
    </ChartCard>
  );
}

export function ValueScatter({ items, hl, setHl, focused }) {
  const { conv, sym } = useMoney();
  const xs = items.map((i) => conv(i.per_kg_protein.typical)), ys = items.map((i) => i.digestibility * 100);
  const mx = median(xs), my = median(ys);
  const corner = items.filter((i, k) => xs[k] <= mx && ys[k] >= my);
  const AC = ["#15803d", "#84cc16", "#f59e0b", "#b91c1c"];
  return (
    <ChartCard id="value_scatter" eyebrow="Value map" cost focused={focused}
      title={corner.length ? `${corner.map((i) => i.name).join(", ")} sit in the value corner (low cost, high digestibility)` : "No source sits in the value corner under current assumptions"}
      data={{ columns: ["Source", "INR/kg protein", "Digestibility", "Protein %", "Allergen risk (0-3)"], rows: items.map((i) => [i.name, i.per_kg_protein.typical, i.digestibility, i.protein_pct, i.allergen_risk]) }}>
      <Plot testid="scatter-plot" height={380} onHover={(e) => setHl(e?.points?.[0]?.customdata || null)} onUnhover={() => setHl(null)}
        data={[0, 1, 2, 3].map((r) => { const sub = items.filter((i) => Math.round(i.allergen_risk) === r); return {
          type: "scatter", mode: "markers+text", name: ["No known allergen", "Low allergen risk", "Moderate", "Major allergen"][r], x: sub.map((i) => conv(i.per_kg_protein.typical)), y: sub.map((i) => i.digestibility * 100),
          text: sub.map((i) => short(i.name, 18)), textposition: "top center", textfont: { size: 9 }, customdata: sub.map((i) => i.key),
          marker: { size: sub.map((i) => 10 + i.protein_pct * 0.35), color: AC[r], symbol: sub.map((i) => (i.kind === "byproduct" ? "circle" : "diamond")), opacity: sub.map((i) => (!hl || hl === i.key ? 0.85 : 0.3)), line: { width: sub.map((i) => (hl === i.key ? 3 : 1)), color: "#1c2b22" } },
          hovertemplate: `<b>%{text}</b><br>${sym}%{x:,.0f}/kg protein · %{y:.0f}% digestible<extra></extra>` }; }).filter((t) => t.x.length)}
        layout={{ xaxis: { title: { text: `${sym} per kg protein` }, rangemode: "tozero" }, yaxis: { title: { text: "Digestibility / quality score" }, range: [55, 105] }, legend: { orientation: "h", y: -0.25 },
          shapes: [{ type: "rect", x0: 0, x1: mx, y0: my, y1: 104, fillcolor: "rgba(21,128,61,.08)", line: { color: "#15803d", dash: "dot" }, layer: "below" }],
          annotations: [{ x: mx / 2, y: 102, text: "Value corner", showarrow: false, font: { size: 10, color: "#15803d" } }], transition: { duration: 500 } }} />
      <p className="text-[11px] text-muted-foreground">Bubble size = protein % · colour = allergen risk · circle = by-product, diamond = conventional.</p>
    </ChartCard>
  );
}

export function ServingPlate({ items, focused }) {
  const { money } = useMoney();
  const sorted = [...items].sort((a, b) => a.per_serving.typical - b.per_serving.typical);
  const maxKg = Math.max(...items.map((i) => i.kg_per_serving)), maxC = Math.max(...items.map((i) => i.per_serving.typical));
  return (
    <ChartCard id="serving" eyebrow="25 g protein plate" cost focused={focused}
      title={`One 25 g protein serving: ${sorted[0].name} costs ${money(sorted[0].per_serving.typical)}; ${sorted[sorted.length - 1].name} ${money(sorted[sorted.length - 1].per_serving.typical)}`}
      data={{ columns: ["Source", "g material per serving", "INR per serving (low)", "typical", "high"], rows: sorted.map((i) => [i.name, (i.kg_per_serving * 1000).toFixed(0), i.per_serving.low, i.per_serving.typical, i.per_serving.high]) }}>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6" data-testid="serving-grid">
        {sorted.map((i, k) => {
          const c = colorOf(i);
          const jar = 30 + (i.kg_per_serving / maxKg) * 70;
          const coins = Math.max(1, Math.round((i.per_serving.typical / maxC) * 8));
          return (
            <li key={i.key} className="fade-up flex flex-col items-center gap-2 rounded-xl border bg-background/60 p-3 text-center" style={{ animationDelay: `${k * 60}ms` }}>
              <div className="flex h-[104px] items-end gap-3" aria-hidden>
                <div className="relative w-12 rounded-b-xl rounded-t-md border-2 border-foreground/30" style={{ height: jar }}>
                  <div className="absolute inset-x-0 bottom-0 rounded-b-lg transition-[height] duration-700" style={{ height: "82%", background: c, backgroundImage: i.kind === "conventional" ? STRIPES : undefined, opacity: 0.85 }} />
                  <div className="absolute -top-2 left-1/2 h-2 w-8 -translate-x-1/2 rounded-sm bg-foreground/40" />
                </div>
                <div className="flex flex-col-reverse gap-0.5">{Array.from({ length: coins }).map((_, j) => <span key={j} className="h-2 w-6 rounded-full border border-amber-700/50 bg-amber-400" />)}</div>
              </div>
              <p className="line-clamp-2 min-h-[2rem] text-[11px] font-semibold leading-tight">{i.name}</p>
              <p className="font-mono text-xs"><b>{Math.round(i.kg_per_serving * 1000)} g</b> material · <b>{money(i.per_serving.typical)}</b></p>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">Jar height = grams of material for 25 g protein · coins = cost per serving.</p>
    </ChartCard>
  );
}

const CRIT = [["cost", "Cost"], ["protein", "Protein %"], ["digestibility", "Digestibility"], ["allergen", "Allergen risk"], ["flavour", "Flavour"], ["supply", "Supply consistency"], ["regulatory", "Regulatory readiness"]];
export const DEFAULT_W = { cost: 5, protein: 3, digestibility: 3, allergen: 3, flavour: 2, supply: 2, regulatory: 3 };

export function criteria(items, metric = "per_kg_dig", costOf = (i) => i[metric].typical) {
  const minC = Math.min(...items.map(costOf)), maxP = Math.max(...items.map((i) => i.protein_pct));
  return Object.fromEntries(items.map((i) => [i.key, { cost: (minC / costOf(i)) * 100, protein: (i.protein_pct / maxP) * 100, digestibility: Math.min(100, i.digestibility * 100),
    allergen: 100 - (i.allergen_risk / 3) * 100, flavour: i.flavour, supply: i.supply, regulatory: i.regulatory }]));
}
export const score = (s, w) => { const tw = Object.values(w).reduce((a, b) => a + b, 0) || 1; return CRIT.reduce((t, [k]) => t + s[k] * w[k], 0) / tw; };

export function CriteriaPanel({ items, weights, setWeights, hl, setHl, focused }) {
  const sc = criteria(items);
  const ranked = [...items].map((i) => ({ i, s: score(sc[i.key], weights) })).sort((a, b) => b.s - a.s);
  const pos = Object.fromEntries(ranked.map((r, k) => [r.i.key, k]));
  const show = [...new Set([...ranked.slice(0, 3).map((r) => r.i.key), ...(hl ? [hl] : [])])].map((k) => items.find((i) => i.key === k));
  return (
    <ChartCard id="criteria_radar" eyebrow="Multi-criteria" focused={focused} title={`With your weights, ${ranked[0].i.name} ranks first (${ranked[0].s.toFixed(0)}/100)`}
      data={{ columns: ["Source", ...CRIT.map(([, l]) => l), "Weighted score"], rows: ranked.map(({ i, s }) => [i.name, ...CRIT.map(([k]) => sc[i.key][k].toFixed(0)), s.toFixed(1)]) }}>
      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        <div className="space-y-2.5" data-testid="weights-panel">
          <p className="eyebrow">What matters to you</p>
          {CRIT.map(([k, l]) => <label key={k} className="block text-xs"><span className="flex justify-between"><span>{l}</span><span className="font-mono">{weights[k]}</span></span>
            <input data-testid={`weight-${k}`} type="range" min={0} max={10} value={weights[k]} onChange={(e) => setWeights((w) => ({ ...w, [k]: Number(e.target.value) }))} className="w-full accent-primary" /></label>)}
          <button data-testid="weights-reset" onClick={() => setWeights(DEFAULT_W)} className="text-xs font-semibold text-primary underline">Reset weights</button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Plot testid="criteria-radar-plot" height={320} data={show.map((i) => ({ type: "scatterpolar", r: [...CRIT.map(([k]) => sc[i.key][k]), sc[i.key].cost], theta: [...CRIT.map(([, l]) => l), CRIT[0][1]], name: short(i.name, 20), fill: "toself", opacity: 0.5, line: { color: colorOf(i), width: hl === i.key ? 4 : 2 } }))}
            layout={{ polar: { radialaxis: { range: [0, 100], tickfont: { size: 8 } }, angularaxis: { tickfont: { size: 9 } } }, margin: { l: 50, r: 50, t: 20, b: 20 }, legend: { orientation: "h", y: -0.15 } }} />
          <div className="relative" style={{ height: items.length * 34 }} data-testid="criteria-ranking">
            {items.map((i) => { const r = ranked[pos[i.key]]; return (
              <div key={i.key} onMouseEnter={() => setHl(i.key)} onMouseLeave={() => setHl(null)} className="absolute inset-x-0 flex items-center gap-2 transition-[top] duration-700" style={{ top: pos[i.key] * 34, height: 30 }}>
                <span className="w-5 font-mono text-[11px] text-muted-foreground">{pos[i.key] + 1}</span>
                <span className="w-28 truncate text-[11px] font-semibold sm:w-36">{i.name}</span>
                <div className="h-4 flex-1 rounded bg-secondary"><div className="h-full rounded transition-[width] duration-700" style={{ width: `${r.s}%`, background: colorOf(i), backgroundImage: i.kind === "conventional" ? STRIPES : undefined }} /></div>
                <span className="w-8 text-right font-mono text-[11px]">{r.s.toFixed(0)}</span>
              </div>); })}
          </div>
        </div>
      </div>
    </ChartCard>
  );
}

export function RankChange({ items, lines, weights, focused }) {
  const [mode, setMode] = useState("weight");
  const xs = mode === "weight" ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const lmap = Object.fromEntries(lines.map((l) => [l.key, l]));
  const ranks = xs.map((x) => {
    const w = mode === "weight" ? { ...weights, cost: x } : weights;
    const costOf = (i) => (mode === "price" && lmap[i.key] ? lmap[i.key].intercept + lmap[i.key].slope * lmap[i.key].raw_typical * x : i.per_kg_dig.typical);
    const sc = criteria(items, "per_kg_dig", costOf);
    const order = [...items].sort((a, b) => score(sc[b.key], w) - score(sc[a.key], w)).map((i) => i.key);
    return Object.fromEntries(order.map((k, j) => [k, j + 1]));
  });
  const swing = items.map((i) => ({ i, a: Math.min(...ranks.map((r) => r[i.key])), b: Math.max(...ranks.map((r) => r[i.key])) })).sort((p, q) => (q.b - q.a) - (p.b - p.a))[0];
  return (
    <ChartCard id="rank_change" eyebrow="Rank change" focused={focused}
      title={swing.b === swing.a ? "Rankings are stable across this sweep" : `${swing.i.name} moves most: between #${swing.a} and #${swing.b} as ${mode === "weight" ? "the cost weight" : "by-product raw prices"} change`}
      data={{ columns: [mode === "weight" ? "Cost weight" : "Raw price multiplier", ...items.map((i) => i.name)], rows: xs.map((x, k) => [x, ...items.map((i) => ranks[k][i.key])]) }}
      right={<div className="flex rounded-full border p-0.5 text-[11px]">{[["weight", "Cost weight"], ["price", "Raw price"]].map(([k, l]) => <button key={k} data-testid={`rank-mode-${k}`} onClick={() => setMode(k)} className={`rounded-full px-2.5 py-1 font-semibold ${mode === k ? "bg-primary text-primary-foreground" : ""}`}>{l}</button>)}</div>}>
      <Plot testid="rank-plot" height={340} data={items.map((i) => ({ type: "scatter", mode: "lines+markers", name: short(i.name, 20), x: xs, y: ranks.map((r) => r[i.key]),
        line: { color: colorOf(i), width: i.kind === "byproduct" ? 3 : 1.5, dash: i.kind === "conventional" ? "dot" : "solid", shape: "hv" }, marker: { size: 5 } }))}
        layout={{ yaxis: { autorange: "reversed", dtick: 1, title: { text: "Rank (1 = best)" } }, xaxis: { title: { text: mode === "weight" ? "Weight given to cost (0-10)" : "By-product raw price × current" } }, legend: { orientation: "h", y: -0.3, font: { size: 10 } },
          shapes: [{ type: "line", x0: mode === "weight" ? weights.cost : 1, x1: mode === "weight" ? weights.cost : 1, yref: "paper", y0: 0, y1: 1, line: { color: "#e7b416", width: 2, dash: "dash" } }] }} />
    </ChartCard>
  );
}

export function VerdictCard({ items, metric, focused, caveat, refKey }) {
  const { money } = useMoney();
  const label = METRICS.find(([k]) => k === metric)[1];
  const sorted = [...items].sort((a, b) => a[metric].typical - b[metric].typical);
  const bps = sorted.filter((i) => i.kind === "byproduct"), conv = sorted.filter((i) => i.kind === "conventional");
  const best = bps.find((i) => i.key === refKey) || bps[0];
  const ref = conv.find((c) => c.key === "spc") || conv[0];
  if (!best || !ref) return null;
  const rel = relation(best[metric], ref[metric]);
  const word = { cheaper: "lower cost than", comparable: "comparable with", "more expensive": "higher cost than" }[rel];
  const text = `${best.name}: estimated ${money(best[metric].low)}–${money(best[metric].high)} ${label} vs ${money(ref[metric].low)}–${money(ref[metric].high)} for ${ref.name.toLowerCase()}: ${word} it under current assumptions.`;
  const pod = sorted.slice(0, 3);
  return (
    <ChartCard id="verdict" eyebrow={best === bps[0] ? "Verdict · lowest-cost by-product" : "Verdict · selected by-product"} cost focused={focused} title={text}
      data={{ columns: ["Conventional source", `Relation of ${best.name}`], rows: conv.map((c) => [c.name, relation(best[metric], c[metric])]) }}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex min-w-0 items-end justify-center gap-2 sm:gap-3" data-testid="verdict-podium" aria-label="Podium: lowest cost first">
          {[pod[1], pod[0], pod[2]].filter(Boolean).map((i) => { const r = sorted.indexOf(i); const h = [130, 100, 80][r]; return (
            <div key={i.key} className="flex w-24 flex-col items-center gap-1 text-center sm:w-28">
              {r === 0 ? <Trophy className="h-5 w-5 text-amber-500" /> : <Medal className="h-5 w-5 text-stone-400" />}
              <p className="line-clamp-2 text-[11px] font-semibold leading-tight">{i.name}</p>
              <p className="font-mono text-[11px]">{money(i[metric].typical)}</p>
              <div className="flex w-full items-start justify-center rounded-t-xl pt-2 font-display text-2xl font-extrabold text-white transition-[height] duration-700" style={{ height: h, background: colorOf(i), backgroundImage: i.kind === "conventional" ? STRIPES : undefined }}>{r + 1}</div>
            </div>); })}
        </div>
        <div className="min-w-0 space-y-3">
          <p className="eyebrow">{best.name} vs each conventional source</p>
          <ul className="flex flex-wrap gap-2" data-testid="verdict-strip">
            {conv.map((c) => { const [col, Icon, l] = REL[relation(best[metric], c[metric])]; return (
              <li key={c.key} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold" style={{ color: col, borderColor: col }}><Icon className="h-3.5 w-3.5" aria-hidden />{short(c.name, 22)}: {l}</li>); })}
          </ul>
          <p data-testid="verdict-caveat" className="rounded-xl border border-amber-600/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">{caveat}</p>
        </div>
      </div>
    </ChartCard>
  );
}

export default function ComparisonSection({ data, refKey, focus, focused: F = () => false }) {
  const [metric, setMetric] = useState("per_kg_dig");
  const [hl, setHl] = useState(null);
  const [weights, setWeights] = useState(DEFAULT_W);
  const [beKey, setBeKey] = useState(null);
  const items = data.items;
  const bestBp = data.verdict?.best;
  const ref = refKey && items.some((i) => i.key === refKey) ? refKey : bestBp;
  const lineKey = beKey || ref || data.lines[0]?.key;
  const line = data.lines.find((l) => l.key === lineKey) || data.lines[0];
  const convSources = useMemo(() => items.filter((i) => i.kind === "conventional").map((i) => ({ name: i.name, target: i.per_kg_dig.typical })), [items]);
  const picker = (
    <label className="text-xs"><span className="sr-only">By-product</span>
      <select data-testid="breakeven-bp-select" value={lineKey} onChange={(e) => setBeKey(e.target.value)} className="field h-8 text-xs">{data.lines.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}</select></label>
  );
  return (
    <div className="space-y-6" data-testid="comparison-section">
      <div className="flex flex-wrap items-center gap-2"><IllustrativeBadge /><span className="text-xs text-muted-foreground">Fixes applied to by-products: {data.fix_mode === "recommended" ? "recommended stack per type" : "none (as-is)"}</span></div>
      <CostRace items={items} metric={metric} setMetric={setMetric} hl={hl} setHl={setHl} focused={F("cost_race")} />
      <div className="grid gap-6 xl:grid-cols-2">
        <RangeBars items={items} metric={metric} refKey={ref} hl={hl} setHl={setHl} focused={F("range_bars")} />
        <ValueScatter items={items} hl={hl} setHl={setHl} focused={F("value_scatter")} />
        {line && <BreakEvenChart line={line} sources={convSources} picker={picker} focused={F("breakeven")} />}
        <RankChange items={items} lines={data.lines} weights={weights} focused={F("rank_change")} />
      </div>
      <ServingPlate items={items} focused={F("serving")} />
      <CriteriaPanel items={items} weights={weights} setWeights={setWeights} hl={hl} setHl={setHl} focused={F("criteria_radar")} />
      <VerdictCard items={items} metric={metric} caveat={data.caveat} refKey={ref} focused={F("verdict")} />
    </div>
  );
}
