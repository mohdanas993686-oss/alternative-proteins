import { useState } from "react";
import { CheckCircle2, Wrench, Ban, RotateCcw, Save, Trash2, Layers } from "lucide-react";
import { toast } from "sonner";
import { Plot } from "@/components/Charts";
import { ChartCard } from "@/components/ChartCard";
import { useMoney, GROUP_COLOR, SCEN_TONE, pct, short } from "@/lib/cost";
import { api, errMsg } from "@/lib/api";

const OVERLAY_C = ["#7c3aed", "#0891b2", "#db2777", "#65a30d"];

export function Waterfall({ est, focused }) {
  const { conv, money, sym } = useMoney();
  const w = est.waterfall;
  const items = w.items.filter((i) => Math.abs(i.per_kg) > 1e-6);
  const top = [...items].sort((a, b) => b.per_kg - a.per_kg)[0];
  const title = `${top.label} is the biggest cost: ${money(top.per_kg)} of ${money(w.total)} ${w.unit}`;
  return (
    <ChartCard id="waterfall" eyebrow="Cost build-up" title={title} cost focused={focused}
      data={{ columns: ["Step", `INR ${w.unit}`, "INR per batch"], rows: [...items.map((i) => [i.label, i.per_kg, i.value]), ["Total", w.total, est.metrics[est.scenario].total]] }}>
      <Plot testid="waterfall-plot" height={360} data={[{ type: "waterfall", orientation: "v", measure: [...items.map(() => "relative"), "total"],
        x: [...items.map((i) => short(i.label, 22)), "Final cost"], y: [...items.map((i) => conv(i.per_kg)), 0], connector: { line: { color: "rgba(120,113,108,.5)", dash: "dot" } },
        increasing: { marker: { color: "#d97706" } }, decreasing: { marker: { color: "#15803d" } }, totals: { marker: { color: "#1f4d36" } },
        texttemplate: "%{y:,.1f}", textposition: "outside", textfont: { size: 9 }, hovertemplate: `%{x}: ${sym}%{y:,.2f} ${w.unit}<extra></extra>` }]}
        layout={{ yaxis: { title: { text: `${sym} ${w.unit}` } }, xaxis: { tickangle: -35, automargin: true }, showlegend: false, margin: { l: 60, r: 10, t: 20, b: 100 }, transition: { duration: 500 } }} />
    </ChartCard>
  );
}

export function Sunburst({ est, focused }) {
  const { conv, money } = useMoney();
  const b = est.breakdown.filter((i) => i.value > 0);
  const groups = [...new Set(b.map((i) => i.group))];
  const gsum = (g) => b.filter((i) => i.group === g).reduce((s, i) => s + i.value, 0);
  const tot = b.reduce((s, i) => s + i.value, 0);
  const topG = [...groups].sort((x, y) => gsum(y) - gsum(x))[0];
  const credit = est.breakdown.find((i) => i.value < 0);
  return (
    <ChartCard id="sunburst" eyebrow="Where the money goes" cost focused={focused}
      title={`${topG} takes ${pct((gsum(topG) / tot) * 100)} of the batch cost${credit ? ` (minus a ${money(-credit.value)} diversion credit)` : ""}; click a ring to drill down`}
      data={{ columns: ["Group", "Item", "INR per batch"], rows: est.breakdown.map((i) => [i.group, i.label, i.value]) }}>
      <Plot testid="sunburst-plot" height={360} data={[{ type: "sunburst", branchvalues: "total", ids: ["Total", ...groups, ...b.map((i, k) => `${i.group}/${k}`)],
        labels: ["Batch cost", ...groups, ...b.map((i) => short(i.label, 24))], parents: ["", ...groups.map(() => "Total"), ...b.map((i) => i.group)],
        values: [conv(tot), ...groups.map((g) => conv(gsum(g))), ...b.map((i) => conv(i.value))],
        marker: { colors: ["#1f4d36", ...groups.map((g) => GROUP_COLOR[g] || "#78716c"), ...b.map((i) => GROUP_COLOR[i.group] || "#78716c")], line: { width: 1.5, color: "rgba(255,255,255,.7)" } },
        hovertemplate: "<b>%{label}</b><br>%{value:,.0f} · %{percentRoot:.0%} of batch<extra></extra>", insidetextorientation: "radial" }]}
        layout={{ margin: { l: 0, r: 0, t: 10, b: 10 } }} />
    </ChartCard>
  );
}

const SC_ICON = { pass: CheckCircle2, fixes: Wrench, rejected: Ban };

export function ScenarioCards({ est, onPick, focused }) {
  const { money, conv } = useMoney();
  const s = Object.fromEntries(est.scenarios.map((x) => [x.key, x]));
  const extra = s.pass.per_kg_product ? ((s.fixes.per_kg_product - s.pass.per_kg_product) / s.pass.per_kg_product) * 100 : 0;
  const title = `Needs fixes costs ${extra >= 0 ? `${extra.toFixed(0)}% more` : `${(-extra).toFixed(0)}% less`} per kg than passing first time; a rejected batch loses ${money(s.rejected.total, 0)}`;
  return (
    <ChartCard id="scenarios" eyebrow="Scenario comparison" title={title} cost focused={focused}
      data={{ columns: ["Scenario", "Total INR per batch", "INR per kg product", "INR per kg digestible protein", "Product kg"], rows: est.scenarios.map((x) => [x.name, x.total, x.per_kg_product ?? "no product", x.per_kg_dig ?? "-", x.product_kg]) }}>
      <div className="grid gap-4 md:grid-cols-3">
        {est.scenarios.map((x) => {
          const Icon = SC_ICON[x.key];
          const g = Object.entries(x.groups);
          const active = est.scenario === x.key;
          return (
            <button key={x.key} type="button" data-testid={`scenario-card-${x.key}`} onClick={() => onPick?.(x.key)} aria-pressed={active}
              className={`rounded-2xl border p-4 text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 ${active ? "shadow-lg ring-2" : ""}`} style={{ borderTop: `5px solid ${SCEN_TONE[x.key]}`, "--tw-ring-color": SCEN_TONE[x.key] }}>
              <p className="flex items-center gap-2 text-sm font-bold" style={{ color: SCEN_TONE[x.key] }}><Icon className="h-4 w-4" aria-hidden />{x.name}</p>
              <p data-testid={`scenario-value-${x.key}`} className="mt-2 font-display text-3xl font-extrabold">{x.per_kg_product ? money(x.per_kg_product) : money(x.loss_per_kg_raw)}</p>
              <p className="text-[11px] text-muted-foreground">{x.per_kg_product ? "per kg product" : "lost per kg raw (no product)"} · {money(x.total, 0)} per batch</p>
              <Plot testid={`scenario-donut-${x.key}`} height={150} data={[{ type: "pie", hole: 0.62, labels: g.map(([k]) => k), values: g.map(([, v]) => conv(v)), sort: false, textinfo: "none",
                marker: { colors: g.map(([k]) => GROUP_COLOR[k] || "#78716c") }, hovertemplate: "%{label}: %{percent}<extra></extra>" }]} layout={{ showlegend: false, margin: { l: 0, r: 0, t: 6, b: 6 } }} />
              {x.range && <p className="text-[11px] text-muted-foreground">Range {money(x.range.low)}–{money(x.range.high)} per kg digestible protein</p>}
            </button>
          );
        })}
      </div>
    </ChartCard>
  );
}

const Slider = ({ label, value, min, max, step, onChange, display, testid }) => (
  <label className="block">
    <span className="mb-1 flex items-center justify-between text-xs font-medium"><span>{label}</span><span className="font-mono font-semibold">{display}</span></span>
    <input data-testid={testid} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
  </label>
);

export function WhatIf({ est, ctx, ov, setOv, stack, saved, setSaved, overlay, setOverlay, focused }) {
  const { money, sym } = useMoney();
  const [name, setName] = useState("");
  const inp = est.inputs;
  const lb = Math.log10(inp.batch_kg);
  const save = async () => {
    if (!name.trim()) return toast.error("Give the scenario a name first");
    try {
      const r = await api.post("/cost/scenarios", { ...ctx, name: name.trim(), fixes: stack, overrides: ov });
      setSaved((s) => [...s, r.data]); setOverlay((o) => [...o, r.data.id]); setName(""); toast.success("Scenario saved");
    } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (id) => { await api.delete(`/cost/scenarios/${id}`); setSaved((s) => s.filter((x) => x.id !== id)); setOverlay((o) => o.filter((x) => x !== id)); };
  const m = est.metrics;
  const sel = m[est.scenario === "rejected" ? "fixes" : est.scenario];
  return (
    <ChartCard id="whatif" eyebrow="What-if" cost focused={focused} hideTable
      title={`At ${Math.round(inp.batch_kg).toLocaleString()} kg and ${money(inp.raw_price)}/kg raw: ${money(sel.per_kg_dig)}/kg digestible protein (expected ${money(m.expected.per_kg_dig)})`}
      data={{ columns: ["Input", "Value"], rows: [["Batch kg", inp.batch_kg], ["Raw price INR/kg", inp.raw_price], ["Yield %", inp.yield_pct], ["Failure probability", inp.failure_prob]] }}
      right={<button data-testid="whatif-reset" onClick={() => setOv({})} className="inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-semibold hover:bg-accent"><RotateCcw className="h-3.5 w-3.5" /> Reset</button>}>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="grid gap-4 sm:grid-cols-2">
          <Slider testid="whatif-batch" label="Batch size (kg)" min={Math.log10(50)} max={Math.log10(20000)} step={0.01} value={lb} display={`${Math.round(inp.batch_kg).toLocaleString()} kg · ${est.scale}`}
            onChange={(v) => setOv((o) => ({ ...o, batch_kg: Math.round(10 ** v) }))} />
          <Slider testid="whatif-raw" label={`Raw price (${sym}/kg)`} min={0} max={inp.raw_price_default * 3} step={0.5} value={inp.raw_price} display={money(inp.raw_price)}
            onChange={(v) => setOv((o) => ({ ...o, raw_price: v }))} />
          <Slider testid="whatif-yield" label="Process yield (%)" min={5} max={100} step={1} value={Math.round(inp.yield_pct)} display={pct(inp.yield_pct)}
            onChange={(v) => setOv((o) => ({ ...o, yield_pct: v }))} />
          <Slider testid="whatif-failure" label="Failure probability" min={0} max={0.6} step={0.01} value={inp.failure_prob} display={pct(inp.failure_prob * 100)}
            onChange={(v) => setOv((o) => ({ ...o, failure_prob: v }))} />
          <div className="sm:col-span-2 grid grid-cols-3 gap-2 text-center">
            {[["per kg product", sel.per_kg_product], ["per kg protein", sel.per_kg_protein], ["expected / kg dig. protein", m.expected.per_kg_dig]].map(([l, v]) => (
              <div key={l} className="rounded-xl bg-secondary p-2"><p className="font-display text-xl font-extrabold transition-all">{money(v)}</p><p className="text-[10px] text-muted-foreground">{l}</p></div>))}
          </div>
        </div>
        <div className="space-y-2 rounded-xl border bg-background/60 p-3">
          <p className="eyebrow flex items-center gap-1"><Layers className="h-3 w-3" /> Saved scenarios (overlay)</p>
          <div className="flex gap-2"><input data-testid="whatif-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Scenario name" maxLength={80} className="field h-9" />
            <button data-testid="whatif-save" onClick={save} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground"><Save className="h-3.5 w-3.5" /> Save</button></div>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {saved.length === 0 && <li className="text-xs text-muted-foreground">No saved scenarios yet.</li>}
            {saved.map((s, i) => <li key={s.id} className="flex items-center gap-2 text-xs">
              <input type="checkbox" data-testid={`overlay-${s.id}`} checked={overlay.includes(s.id)} onChange={(e) => setOverlay((o) => (e.target.checked ? [...o, s.id] : o.filter((x) => x !== s.id)))} className="accent-primary" aria-label={`Overlay ${s.name}`} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: OVERLAY_C[i % 4] }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{s.name} <span className="text-muted-foreground">· {money(s.summary.per_kg_dig)}/kg</span></span>
              <button aria-label={`Delete ${s.name}`} onClick={() => del(s.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></li>)}
          </ul>
          <p className="text-[10px] text-muted-foreground">Overlays appear on the Monte Carlo and batch-size charts.</p>
        </div>
      </div>
    </ChartCard>
  );
}

export function Tornado({ est, focused }) {
  const { conv, money, sym } = useMoney();
  const t = est.tornado, rows = t.rows;
  const top = rows[rows.length - 1];
  return (
    <ChartCard id="tornado" eyebrow="Sensitivity" cost focused={focused} title={top ? `${top.input} moves the cost most: ${money(Math.min(top.low, top.high))} to ${money(Math.max(top.low, top.high))} per kg digestible protein` : "Sensitivity"}
      data={{ columns: ["Input", "Low input", "High input", "INR/kg dig. protein at low", "at high"], rows: rows.map((r) => [r.input, r.low_input, r.high_input, r.low, r.high]) }}>
      <Plot testid="tornado-plot" height={380} data={[["low", "Input −"], ["high", "Input +"]].map(([k, n]) => ({ type: "bar", orientation: "h", name: n, y: rows.map((r) => r.input),
        x: rows.map((r) => conv(r[k] - t.base)), base: conv(t.base), marker: { color: rows.map((r) => (r[k] > t.base ? "#b91c1c" : "#15803d")), pattern: { shape: k === "high" ? "/" : "" } },
        customdata: rows.map((r) => r[`${k}_input`]), hovertemplate: `%{y} %{customdata:,.2f}: ${sym}%{x:+,.0f}<extra>${n}</extra>` }))}
        layout={{ barmode: "overlay", xaxis: { title: { text: `${sym}/kg digestible protein (expected)` } }, yaxis: { automargin: true }, margin: { l: 10, r: 10, t: 10, b: 70 },
          shapes: [{ type: "line", x0: conv(t.base), x1: conv(t.base), yref: "paper", y0: 0, y1: 1, line: { color: "#1f4d36", width: 2 } }], transition: { duration: 500 } }} />
      <p className="text-[11px] text-muted-foreground">Each input moved ±25% (batch ±50%, yield and digestibility ±10%). Red = cost rises, green = cost falls; hatched bar = input raised.</p>
    </ChartCard>
  );
}

export function MonteCarlo({ est, saved, overlay, focused }) {
  const { conv, money, sym } = useMoney();
  const mc = est.monte_carlo;
  const ov = saved.filter((s) => overlay.includes(s.id));
  const lines = [["P10", mc.p10, "#15803d"], ["P50", mc.p50, "#1f4d36"], ["P90", mc.p90, "#b91c1c"]];
  return (
    <ChartCard id="monte_carlo" eyebrow="Uncertainty" cost focused={focused} title={`80% of ${mc.n} simulated batches land between ${money(mc.p10)} and ${money(mc.p90)} per kg digestible protein (median ${money(mc.p50)})`}
      data={{ columns: [`Bin centre (INR/kg dig. protein)`, "Batches"], rows: mc.bins.map((b, i) => [b, mc.counts[i]]) }}>
      <Plot testid="mc-plot" height={330} data={[{ type: "bar", x: mc.bins.map(conv), y: mc.counts, width: conv(mc.width) * 0.92, marker: { color: "rgba(21,128,61,.55)" }, hovertemplate: `${sym}%{x:,.0f}: %{y} batches<extra></extra>` },
        ...ov.map((s, i) => ({ type: "scatter", mode: "lines", name: s.name, x: [conv(s.summary.p50), conv(s.summary.p50)], y: [0, Math.max(...mc.counts)], line: { color: OVERLAY_C[saved.indexOf(s) % 4], dash: "dash", width: 2 } }))]}
        layout={{ showlegend: ov.length > 0, xaxis: { title: { text: `${sym}/kg digestible protein` } }, yaxis: { title: { text: "Simulated batches" } }, bargap: 0,
          shapes: lines.map(([, v, c]) => ({ type: "line", x0: conv(v), x1: conv(v), yref: "paper", y0: 0, y1: 1, line: { color: c, width: 2, dash: "dot" } })),
          annotations: lines.map(([l, v, c]) => ({ x: conv(v), yref: "paper", y: 1.07, text: l, showarrow: false, font: { size: 10, color: c } })), transition: { duration: 500 } }} />
      <p className="text-[11px] text-muted-foreground">Random raw price, fix and testing costs, yield and failure (p = {pct(mc.failure_prob * 100)}). Seeded for repeatable results.</p>
    </ChartCard>
  );
}

export function BatchCurve({ est, saved, overlay, focused }) {
  const { conv, money, sym } = useMoney();
  const c = est.batch_curve;
  const ov = saved.filter((s) => overlay.includes(s.id));
  const drop = ((c[0].per_kg_dig - c[c.length - 1].per_kg_dig) / c[0].per_kg_dig) * 100;
  return (
    <ChartCard id="batch_curve" eyebrow="Scale" cost focused={focused} title={`Scaling from ${c[0].batch_kg} kg to ${c[c.length - 1].batch_kg.toLocaleString()} kg cuts cost per kg digestible protein by ${drop.toFixed(0)}%`}
      data={{ columns: ["Batch kg", "Scale", "INR/kg dig. protein", "INR/kg product"], rows: c.map((r) => [r.batch_kg, r.scale, r.per_kg_dig, r.per_kg_product]) }}>
      <Plot testid="batch-plot" height={330} data={[
        { type: "scatter", mode: "lines+markers", name: "Current settings", x: c.map((r) => r.batch_kg), y: c.map((r) => conv(r.per_kg_dig)), line: { color: "#1f4d36", width: 3, shape: "spline" }, hovertemplate: `%{x:,} kg: ${sym}%{y:,.0f}<extra></extra>` },
        ...ov.map((s) => ({ type: "scatter", mode: "lines", name: s.name, x: s.summary.batch_curve.map((r) => r.batch_kg), y: s.summary.batch_curve.map((r) => conv(r.per_kg_dig)), line: { color: OVERLAY_C[saved.indexOf(s) % 4], dash: "dash" } })),
        { type: "scatter", mode: "markers", name: "This batch", x: [est.batch_kg], y: [conv(est.metrics.fixes.per_kg_dig)], marker: { size: 14, color: "#e7b416", symbol: "star", line: { width: 1, color: "#1c2b22" } } },
      ]}
        layout={{ xaxis: { type: "log", title: { text: "Batch size (kg, log scale)" } }, yaxis: { title: { text: `${sym}/kg digestible protein` } }, legend: { orientation: "h", y: -0.3 },
          shapes: [[50, 200, "rgba(185,28,28,.06)"], [200, 2000, "rgba(217,119,6,.06)"], [2000, 20000, "rgba(21,128,61,.06)"]].map(([a, b, f]) => ({ type: "rect", x0: a, x1: b, yref: "paper", y0: 0, y1: 1, fillcolor: f, line: { width: 0 }, layer: "below" })),
          annotations: [[100, "lab"], [630, "pilot"], [6300, "industrial"]].map(([x, t]) => ({ x: Math.log10(x), xref: "x", yref: "paper", y: 0.97, text: t, showarrow: false, font: { size: 10 } })), transition: { duration: 500 } }} />
      <p className="text-[11px] text-muted-foreground">Testing is a fixed cost per batch and processing gets cheaper per kg at pilot and industrial scale. Current point {money(est.metrics.fixes.per_kg_dig)}.</p>
    </ChartCard>
  );
}

export function BreakEvenChart({ line, sources, focused, picker, id = "breakeven" }) {
  const { conv, money, sym } = useMoney();
  const xmax = Math.max(line.raw_typical * 3, 10);
  const xs = Array.from({ length: 21 }, (_, i) => (xmax * i) / 20);
  const cross = sources.map((s) => ({ ...s, x: line.slope > 0 ? (s.target - line.intercept) / line.slope : null })).map((s) => ({ ...s, ok: s.x != null && s.x >= 0 && s.x <= xmax }));
  const reach = cross.filter((s) => s.ok && s.x >= line.raw_typical).sort((a, b) => a.x - b.x)[0];
  const below = cross.filter((s) => s.x != null && s.x < 0);
  const title = reach ? `${line.name} matches ${reach.name.toLowerCase()} while raw material costs up to ${money(reach.x)}/kg (now ${money(line.raw_typical)})`
    : `${line.name} stays above ${below.length ? below[0].name.toLowerCase() : "the cheapest sources"} even at zero raw price under current assumptions`;
  return (
    <ChartCard id={id} eyebrow="Break-even" cost focused={focused} title={title} right={picker}
      data={{ columns: ["Conventional source", "Its INR/kg dig. protein", "Break-even raw price (INR/kg)"], rows: cross.map((s) => [s.name, s.target, s.x != null && s.x >= 0 ? s.x : "not reachable"]) }}>
      <Plot testid={`${id}-plot`} height={360} data={[
        { type: "scatter", mode: "lines", name: line.name, x: xs, y: xs.map((x) => conv(line.intercept + line.slope * x)), line: { color: "#1f4d36", width: 3 }, hovertemplate: `raw ${sym}%{x:.0f}/kg → ${sym}%{y:,.0f}<extra></extra>` },
        { type: "scatter", mode: "markers+text", name: "Break-even", x: cross.filter((s) => s.ok).map((s) => s.x), y: cross.filter((s) => s.ok).map((s) => conv(s.target)),
          text: cross.filter((s) => s.ok).map((s) => money(s.x, 0)), textposition: "top right", textfont: { size: 10 }, marker: { size: 11, color: "#e7b416", symbol: "diamond", line: { width: 1, color: "#1c2b22" } } },
        { type: "scatter", mode: "markers", name: "Current raw price", x: [line.raw_typical], y: [conv(line.intercept + line.slope * line.raw_typical)], marker: { size: 13, color: "#d97706", symbol: "star" } },
      ]}
        layout={{ xaxis: { title: { text: `Raw-material price (${sym}/kg)` }, range: [0, xmax] }, yaxis: { title: { text: `${sym}/kg digestible protein` } }, legend: { orientation: "h", y: -0.25 },
          shapes: sources.map((s) => ({ type: "line", xref: "paper", x0: 0, x1: 1, y0: conv(s.target), y1: conv(s.target), line: { color: "#475569", dash: "dash", width: 1 } })),
          annotations: sources.map((s) => ({ xref: "paper", x: 1, y: conv(s.target), xanchor: "right", yanchor: "bottom", text: short(s.name, 30), showarrow: false, font: { size: 9, color: "#475569" } })), transition: { duration: 500 } }} />
    </ChartCard>
  );
}
