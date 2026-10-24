import { Ban, Check } from "lucide-react";
import { FIX_TONE, PROBLEM_ICON, useMoney } from "@/lib/cost";
import { StatusBadge } from "@/components/common";

const NW = 236, NH = 60, GAP = 12, COLX = [0, 272, 544, 846], WIDTH = 1084;

const Node = ({ x, y, tone, icon: Icon, title, sub, onClick, active, selected, testid, badge }) => (
  <button type="button" data-testid={testid} onClick={onClick} disabled={!onClick}
    className={`absolute flex items-start gap-2 rounded-xl border bg-card p-2.5 text-left shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 ${active ? "ring-2 ring-amber-400" : ""}`}
    style={{ left: x, top: y, width: NW, height: NH, borderLeft: `5px solid ${tone}` }}>
    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg" style={{ background: `${tone}1f`, color: tone }}><Icon className="h-3.5 w-3.5" aria-hidden /></span>
    <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold leading-tight">{title}</span><span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">{sub}</span></span>
    {selected && <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-label="in fix stack" />}
    {badge}
  </button>
);

const edge = (x1, y1, x2, y2) => `M ${x1} ${y1} C ${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`;

export function buildLayout(est, cat, problemFilter) {
  const probs = est.problems.filter((p) => problemFilter === "all" || p.problem === problemFilter);
  const nodes = [], edges = [];
  let y = 0;
  for (const p of probs) {
    const ids = est.options[p.problem] || [];
    const safety = p.category === "safety";
    const div = ids.map((i) => cat[i]).find((f) => f?.status === "Divert or reject");
    const opts = ids.map((i) => cat[i]).filter((f) => f && f.status !== "Divert or reject");
    const n = Math.max(opts.length, 1);
    const blockH = n * (NH + GAP);
    const py = y + (blockH - NH - GAP) / 2;
    nodes.push({ kind: "problem", p, x: COLX[1], y: py });
    opts.forEach((f, i) => {
      const fy = y + i * (NH + GAP);
      nodes.push({ kind: "fix", f, x: COLX[2], y: fy });
      edges.push({ d: edge(COLX[1] + NW, py + NH / 2, COLX[2], fy + NH / 2), tone: FIX_TONE[f.status].color, dash: f.status !== "Fixable" });
      if (safety) edges.push({ d: edge(COLX[2] + NW, fy + NH / 2, COLX[3], py + NH / 2), tone: "#b91c1c", dash: true, label: "human review", lx: COLX[2] + NW + 20, ly: (fy + py) / 2 + NH / 2 - 4 });
    });
    if (!opts.length) nodes.push({ kind: "none", x: COLX[2], y: py, safety });
    if (safety) {
      nodes.push({ kind: "terminal", f: div, p, x: COLX[3], y: py });
      if (!opts.length) edges.push({ d: edge(COLX[1] + NW, py + NH / 2, COLX[3], py + NH / 2), tone: "#b91c1c", dash: true, label: "no reprocessing fix", lx: COLX[2] + 40, ly: py + NH / 2 - 6 });
    }
    edges.push({ root: true, py });
    y += blockH + GAP * 2;
  }
  const H = Math.max(y - GAP * 2, NH);
  const ry = (H - NH) / 2;
  edges.filter((e) => e.root).forEach((e) => { e.d = edge(NW, ry + NH / 2, COLX[1], e.py + NH / 2); e.tone = "#78716c"; });
  return { nodes, edges, H, ry, probs };
}

export default function FixFinder({ est, cat, problemFilter = "all", stack = [], hl, onPin, onHover }) {
  const { money } = useMoney();
  const { nodes, edges, H, ry, probs } = buildLayout(est, cat, problemFilter);
  if (!probs.length) return <p data-testid="fix-finder-empty" className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No problems detected for this selection: no corrective action needed.</p>;
  const prof = est.profile;
  return (
    <div className="overflow-x-auto pb-2" data-testid="fix-finder">
      <div className="relative" style={{ width: WIDTH, height: H + 8 }}>
        <svg className="absolute inset-0" width={WIDTH} height={H + 8} aria-hidden>
          <defs>{["#78716c", "#15803d", "#b45309", "#b91c1c"].map((c) => <marker key={c} id={`arr${c.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={c} /></marker>)}</defs>
          {edges.map((e, i) => <g key={i}><path d={e.d} fill="none" stroke={e.tone} strokeWidth="1.6" strokeDasharray={e.dash ? "5 4" : undefined} markerEnd={`url(#arr${e.tone.slice(1)})`} opacity=".8" />
            {e.label && <text x={e.lx} y={e.ly} fontSize="9.5" fill={e.tone} fontFamily="JetBrains Mono, monospace">{e.label}</text>}</g>)}
        </svg>
        <Node testid="fix-finder-root" x={COLX[0]} y={ry} tone={prof.safety_block ? "#b91c1c" : prof.overall_status === "PASS" ? "#15803d" : "#b45309"} icon={PROBLEM_ICON["alert-triangle"]}
          title={prof.kind === "sample" ? prof.label.split(" · ")[0] : prof.label} sub={`${est.problems.length} flagged problem(s)`} badge={prof.overall_status && <span className="absolute -top-2.5 right-2"><StatusBadge status={prof.overall_status} testid="fix-finder-root-status" /></span>} />
        {nodes.map((n, i) => {
          if (n.kind === "problem") {
            const tone = n.p.category === "safety" ? "#b91c1c" : n.p.status === "FAIL" ? "#b91c1c" : "#b45309";
            return <Node key={i} testid={`ff-problem-${n.p.problem}`} x={n.x} y={n.y} tone={tone} icon={PROBLEM_ICON[n.p.icon] || PROBLEM_ICON["alert-triangle"]} title={n.p.label} sub={n.p.message} />;
          }
          if (n.kind === "fix") {
            const t = FIX_TONE[n.f.status];
            return <div key={i} onMouseEnter={() => onHover?.(n.f.id)} onMouseLeave={() => onHover?.(null)}>
              <Node testid={`ff-fix-${n.f.id}`} x={n.x} y={n.y} tone={t.color} icon={t.Icon} title={n.f.action} sub={`${money(n.f.cost_typical)}/kg · −${n.f.protein_loss_pct}% protein`} onClick={() => onPin(n.f.id)} active={hl === n.f.id} selected={stack.includes(n.f.id)} />
            </div>;
          }
          if (n.kind === "terminal") return <Node key={i} testid={`ff-terminal-${n.p.problem}`} x={n.x} y={n.y} tone="#b91c1c" icon={Ban} title="Divert or reject" sub="Human review required" onClick={n.f ? () => onPin(n.f.id) : undefined} />;
          return <Node key={i} x={n.x} y={n.y} tone="#a8a29e" icon={Ban} title="No catalogue option" sub="No fix listed for this by-product" />;
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground" aria-label="Legend">
        {Object.entries(FIX_TONE).map(([k, t]) => <li key={k} className="flex items-center gap-1.5"><t.Icon className="h-3.5 w-3.5" style={{ color: t.color }} aria-hidden />{t.label}</li>)}
        <li className="flex items-center gap-1.5"><span className="inline-block w-6 border-t-2 border-dashed border-stone-500" />needs validation or review</li>
      </ul>
    </div>
  );
}
