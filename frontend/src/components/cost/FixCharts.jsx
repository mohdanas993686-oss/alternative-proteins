import { useEffect, useMemo, useState } from "react";
import { Plot } from "@/components/Charts";
import { ChartCard } from "@/components/ChartCard";
import { METHOD_LABEL, bestValue, fixScores, median, useMoney, short } from "@/lib/cost";

const pid = (e) => e?.points?.[0]?.customdata?.[5] ?? e?.points?.[0]?.customdata;

export function FixHeatmap({ fixes, problems, bp, problem, hl, onHover, onPin, focused }) {
  const { money } = useMoney();
  const fs = useMemo(() => fixes.filter((f) => !bp || f.byproducts.includes(bp)), [fixes, bp]);
  const rows = Object.keys(problems).filter((p) => fs.some((f) => f.problem === p));
  const cols = Object.keys(METHOD_LABEL).filter((m) => fs.some((f) => f.method === m)).concat([...new Set(fs.map((f) => f.method))].filter((m) => !METHOD_LABEL[m]));
  const cell = (p, m) => fs.find((f) => f.problem === p && f.method === m);
  const live = (f) => f && f.status !== "Divert or reject";
  const z = rows.map((p) => cols.map((m) => (live(cell(p, m)) ? Math.log10(1 + cell(p, m).cost_typical) : null)));
  const text = rows.map((p) => cols.map((m) => { const f = cell(p, m); return !f ? "" : live(f) ? `−${f.protein_loss_pct}%` : "✕"; }));
  const cd = rows.map((p) => cols.map((m) => { const f = cell(p, m); return f ? [f.action, money(f.cost_typical), f.protein_loss_pct, f.time_h, f.status, f.id] : ["", "", "", "", "", ""]; }));
  const ylab = rows.map((p) => short(problems[p].label, 30));
  const xlab = cols.map((m) => METHOD_LABEL[m] || m);
  const pts = [], divs = [];
  rows.forEach((p, i) => cols.forEach((m, j) => { const f = cell(p, m); if (!f) return; (live(f) ? pts : divs).push({ x: xlab[j], y: ylab[i], f }); }));
  const shapes = [];
  if (problem !== "all" && rows.includes(problem)) { const i = rows.indexOf(problem); shapes.push({ type: "rect", xref: "paper", x0: 0, x1: 1, y0: i - 0.5, y1: i + 0.5, line: { color: "#e7b416", width: 2 } }); }
  const hf = fs.find((f) => f.id === hl);
  if (hf) { const i = rows.indexOf(hf.problem), j = cols.indexOf(hf.method); shapes.push({ type: "rect", x0: j - 0.5, x1: j + 0.5, y0: i - 0.5, y1: i + 0.5, line: { color: "#e7b416", width: 3 } }); }
  const scope = fs.filter((f) => live(f) && (problem === "all" || f.problem === problem));
  const cheap = [...scope].sort((a, b) => a.cost_typical - b.cost_typical)[0];
  const dear = [...scope].sort((a, b) => b.cost_typical - a.cost_typical)[0];
  const title = !cheap ? "This problem has no reprocessing fix: divert or reject, human review required"
    : problem === "all" ? `Fixes range from ${money(cheap.cost_typical)}/kg (${METHOD_LABEL[cheap.method] || cheap.method}) to ${money(dear.cost_typical)}/kg (${METHOD_LABEL[dear.method] || dear.method}); ✕ rows have no reprocessing fix`
      : `For ${problems[problem].label.toLowerCase()}: ${cheap.action.toLowerCase()} is cheapest at ${money(cheap.cost_typical)}/kg (−${cheap.protein_loss_pct}% protein)`;
  const ticks = [1, 3, 10, 30, 80];
  return (
    <ChartCard id="heatmap" eyebrow="Fix comparison" title={title} cost focused={focused}
      data={{ columns: ["Problem", "Fix", "Status", "Cost low (INR/kg)", "Cost typical", "Cost high", "Protein loss %", "Time h", "Retest"], rows: fs.map((f) => [f.problem_label, f.action, f.status, f.cost_low, f.cost_typical, f.cost_high, f.protein_loss_pct, f.time_h, f.retest.join(" ")]) }}>
      <Plot testid="heatmap-plot" height={Math.max(340, rows.length * 34 + 140)}
        onHover={(e) => onHover(pid(e) || null)} onUnhover={() => onHover(null)} onClick={(e) => pid(e) && onPin(pid(e))}
        data={[
          { type: "heatmap", x: xlab, y: ylab, z, text, texttemplate: "%{text}", textfont: { size: 10, color: "#fff" }, customdata: cd, hoverongaps: false, xgap: 3, ygap: 3,
            colorscale: [[0, "#15803d"], [0.45, "#ca8a04"], [1, "#b91c1c"]], zmin: Math.log10(2), zmax: Math.log10(86),
            colorbar: { title: { text: "Cost/kg", side: "right" }, tickvals: ticks.map((t) => Math.log10(1 + t)), ticktext: ticks.map((t) => money(t, 0)), thickness: 10 },
            hovertemplate: "<b>%{customdata[0]}</b><br>Cost %{customdata[1]}/kg · protein loss %{customdata[2]}%<br>%{customdata[3]} h · %{customdata[4]}<extra></extra>" },
          { type: "scatter", mode: "markers", x: pts.map((p) => p.x), y: pts.map((p) => p.y), hoverinfo: "skip", showlegend: false,
            marker: { symbol: "circle-open", size: pts.map((p) => 8 + p.f.protein_loss_pct * 0.9), color: "rgba(255,255,255,.75)", line: { width: 1.5 } } },
          { type: "scatter", mode: "markers", x: divs.map((p) => p.x), y: divs.map((p) => p.y), name: "Divert or reject", customdata: divs.map((p) => [p.f.action, "", "", "", p.f.status, p.f.id]),
            marker: { symbol: "x-thin-open", size: 20, color: "#b91c1c", line: { width: 3, color: "#b91c1c" } }, hovertemplate: "<b>%{customdata[0]}</b><br>No reprocessing fix · human review required<extra></extra>" },
        ]}
        layout={{ margin: { l: 210, r: 20, t: 10, b: 110 }, xaxis: { tickangle: -40, automargin: true }, yaxis: { autorange: "reversed", automargin: true }, shapes, showlegend: false }} />
      <p className="mt-2 text-[11px] text-muted-foreground">Cell colour = cost per kg input · text and ring size = protein loss · ✕ = divert or reject only.</p>
    </ChartCard>
  );
}

export function FixBubble({ fixes, problems, bp, problemKey, hl, onHover, onPin, focused, picker }) {
  const { money, conv } = useMoney();
  const p = problems[problemKey];
  const fs = fixes.filter((f) => f.problem === problemKey && f.byproducts.includes(bp) && f.status !== "Divert or reject" && f.effectiveness != null);
  const best = bestValue(fs);
  const safety = p?.category === "safety";
  const title = safety ? "Safety failures are not ranked by value: divert or reject, human review required"
    : best ? `${best.action} removes ~${best.effectiveness}% of the problem for ${money(best.cost_typical)}/kg: best value for ${p.label.toLowerCase()}` : "No fix options for this problem";
  const xs = fs.map((f) => conv(f.cost_typical)), ys = fs.map((f) => f.effectiveness);
  const mx = median(xs), my = median(ys);
  return (
    <ChartCard id="bubble" eyebrow="Value per problem" title={title} cost focused={focused} right={picker}
      data={{ columns: ["Fix", "Cost typical (INR/kg)", "Effectiveness %", "Protein loss %", "Time h"], rows: fs.map((f) => [f.action, f.cost_typical, f.effectiveness, f.protein_loss_pct, f.time_h]) }}>
      {safety || !fs.length ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{title}</p> : (
        <Plot testid="bubble-plot" height={340} onHover={(e) => onHover(e?.points?.[0]?.customdata || null)} onUnhover={() => onHover(null)} onClick={(e) => e?.points?.[0]?.customdata && onPin(e.points[0].customdata)}
          data={[{ type: "scatter", mode: "markers+text", x: xs, y: ys, text: fs.map((f) => short(f.action, 22)), textposition: "top center", textfont: { size: 10 }, customdata: fs.map((f) => f.id),
            marker: { size: fs.map((f) => 16 + f.protein_loss_pct * 1.1), color: fs.map((f) => f.time_h), colorscale: [[0, "#bbf7d0"], [0.5, "#22c55e"], [1, "#14532d"]], cmin: 0, cmax: 36,
              colorbar: { title: { text: "Hours" }, thickness: 10 }, opacity: fs.map((f) => (!hl || hl === f.id ? 0.9 : 0.35)), line: { width: fs.map((f) => (hl === f.id ? 4 : 1)), color: fs.map((f) => (hl === f.id ? "#e7b416" : "#1c2b22")) } },
            hovertemplate: "<b>%{text}</b><br>%{x:.1f}/kg · %{y}% effective<extra></extra>" }]}
          layout={{ xaxis: { title: { text: "Cost per kg input" }, rangemode: "tozero" }, yaxis: { title: { text: "Effectiveness (% of problem removed)" }, range: [0, 110] },
            shapes: [{ type: "rect", x0: 0, x1: mx, y0: my, y1: 108, fillcolor: "rgba(21,128,61,.09)", line: { color: "#15803d", dash: "dot", width: 1 }, layer: "below" }],
            annotations: [{ x: mx / 2 || 0.5, y: 104, text: "Best value zone", showarrow: false, font: { size: 10, color: "#15803d" } }], transition: { duration: 500, easing: "cubic-in-out" } }} />
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">Bubble size = protein loss · colour = time needed.</p>
    </ChartCard>
  );
}

const AXES = ["Cost", "Speed", "Protein retention", "Effectiveness", "Ease of scale-up"];
const COLORS = ["#15803d", "#d97706", "#0369a1"];

export function FixRadar({ fixes, bp, problemKey, stack, hl, focused }) {
  const cands = useMemo(() => fixes.filter((f) => f.byproducts.includes(bp) && f.status !== "Divert or reject" && (f.problem === problemKey || stack.includes(f.id))), [fixes, bp, problemKey, stack]);
  const [sel, setSel] = useState([]);
  useEffect(() => {
    const ranked = [...cands].sort((a, b) => (b.effectiveness ?? 0) / Math.max(b.cost_typical, 0.5) - (a.effectiveness ?? 0) / Math.max(a.cost_typical, 0.5));
    setSel(ranked.slice(0, 3).map((f) => f.id));
  }, [cands]);
  const chosen = sel.map((id) => fixes.find((f) => f.id === id)).filter(Boolean);
  const scored = chosen.map((f) => ({ f, s: fixScores(f, fixes) }));
  const avg = (s) => AXES.reduce((t, a) => t + s[a], 0) / AXES.length;
  const top = [...scored].sort((a, b) => avg(b.s) - avg(a.s))[0];
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 3 ? [...s.slice(1), id] : [...s, id]));
  return (
    <ChartCard id="fix_radar" eyebrow="Trade-offs" title={top ? `${top.f.action} has the best all-round balance (${avg(top.s).toFixed(0)}/100)` : "Pick up to 3 fixes to compare"} focused={focused}
      data={{ columns: ["Fix", ...AXES], rows: scored.map(({ f, s }) => [f.action, ...AXES.map((a) => s[a].toFixed(0))]) }}>
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Fixes to overlay">
        {cands.map((f) => <button key={f.id} data-testid={`radar-chip-${f.id}`} aria-pressed={sel.includes(f.id)} onClick={() => toggle(f.id)}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${sel.includes(f.id) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{short(f.action, 26)}</button>)}
      </div>
      <Plot testid="fix-radar-plot" height={330} data={scored.map(({ f, s }, i) => ({ type: "scatterpolar", r: [...AXES.map((a) => s[a]), s[AXES[0]]], theta: [...AXES, AXES[0]], name: short(f.action, 24), fill: "toself",
        opacity: !hl || hl === f.id ? 0.6 : 0.25, line: { color: COLORS[i], width: hl === f.id ? 4 : 2 } }))}
        layout={{ polar: { radialaxis: { range: [0, 100], tickfont: { size: 9 } } }, margin: { l: 40, r: 40, t: 20, b: 20 }, legend: { orientation: "h", y: -0.1 } }} />
      <p className="text-[11px] text-muted-foreground">Higher = better on every axis (cheaper, faster, keeps more protein).</p>
    </ChartCard>
  );
}
