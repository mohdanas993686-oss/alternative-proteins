import { useState } from "react";
import { GripVertical, X, ChevronLeft, ChevronRight, RotateCcw, Trash2, Factory, Ban, Plus } from "lucide-react";
import { ChartCard } from "@/components/ChartCard";
import { FIX_TONE, useMoney, short, kg } from "@/lib/cost";

const Station = ({ st, i, n, batch, onMove, onRemove, hl, onHover, fixed }) => {
  const { money } = useMoney();
  const side = Math.max(18, Math.sqrt(st.mass / batch) * 70);
  return (
    <li data-testid={`stack-step-${i}`} onMouseEnter={() => onHover?.(st.fix_id)} onMouseLeave={() => onHover?.(null)}
      className={`fade-up relative flex w-44 shrink-0 flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm transition-shadow ${hl && hl === st.fix_id ? "ring-2 ring-amber-400" : ""}`}>
      <div className="flex items-start justify-between gap-1">
        <span className="font-mono text-[10px] text-muted-foreground">{fixed ? "final" : `step ${i}`}</span>
        {!fixed && <span className="flex gap-0.5">
          <button aria-label="Move earlier" data-testid={`stack-left-${i}`} disabled={i === 1} onClick={() => onMove(i - 1, -1)} className="rounded p-0.5 hover:bg-accent disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <button aria-label="Move later" data-testid={`stack-right-${i}`} disabled={i === n} onClick={() => onMove(i - 1, 1)} className="rounded p-0.5 hover:bg-accent disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button>
          <button aria-label="Remove step" data-testid={`stack-remove-${i}`} onClick={() => onRemove(i - 1)} className="rounded p-0.5 hover:bg-accent hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
        </span>}
      </div>
      <p className="line-clamp-2 min-h-[2rem] text-xs font-semibold leading-tight">{st.step}</p>
      <div className="flex h-[74px] items-end justify-center"><div className="rounded-md bg-gradient-to-br from-amber-300 to-amber-600 shadow-inner transition-[width,height] duration-700" style={{ width: side, height: side }} aria-hidden /></div>
      <dl className="grid grid-cols-2 gap-x-2 text-[10.5px]">
        <dt className="text-muted-foreground">Mass</dt><dd className="text-right font-mono font-semibold">{kg(st.mass)}</dd>
        <dt className="text-muted-foreground">Protein</dt><dd className="text-right font-mono font-semibold">{kg(st.protein)}</dd>
        <dt className="text-muted-foreground">Cost so far</dt><dd className="text-right font-mono font-semibold">{money(st.cost_so_far, 0)}</dd>
      </dl>
    </li>
  );
};

export default function StackBuilder({ est, fixes, stack, setStack, problemFilter, hl, onHover, onPin, focused }) {
  const { money } = useMoney();
  const [over, setOver] = useState(false);
  const bp = est.profile.byproduct;
  const detected = new Set(est.problems.map((p) => p.problem));
  const pal = fixes.filter((f) => f.byproducts.includes(bp) && (problemFilter === "all" || f.problem === problemFilter))
    .sort((a, b) => (detected.has(b.problem) - detected.has(a.problem)) || a.problem.localeCompare(b.problem));
  const add = (id) => { const f = fixes.find((x) => x.id === id); if (f && f.status !== "Divert or reject" && !stack.includes(id)) setStack([...stack, id]); };
  const move = (i, d) => { const s = [...stack]; [s[i], s[i + d]] = [s[i + d], s[i]]; setStack(s); };
  const flow = est.flow;
  const batch = est.batch_kg;
  const last = flow[flow.length - 1];
  const steps = flow.slice(1, -1);
  const m = est.metrics.fixes;
  const title = stack.length ? `Your ${stack.length}-step line keeps ${Math.round((last.mass / batch) * 100)}% of the batch and ${Math.round((last.protein / flow[0].protein) * 100)}% of the protein for ${money(m.per_kg_product)}/kg product`
    : `No fixes yet: drag fixes onto the line (as-is cost ${money(m.per_kg_product)}/kg product)`;
  return (
    <ChartCard id="stack" eyebrow="Fix stack builder" title={title} cost focused={focused}
      data={{ columns: ["Step", "Mass kg", "Protein kg", "Cost so far (INR)"], rows: flow.map((s) => [s.step, s.mass.toFixed(0), s.protein.toFixed(1), Math.round(s.cost_so_far)]) }}
      right={<>
        <button data-testid="stack-recommended-btn" onClick={() => setStack(est.recommended)} className="inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-semibold hover:bg-accent"><RotateCcw className="h-3.5 w-3.5" /> Recommended</button>
        <button data-testid="stack-clear-btn" onClick={() => setStack([])} className="inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-semibold hover:bg-accent"><Trash2 className="h-3.5 w-3.5" /> Clear</button>
      </>}>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div>
          <p className="eyebrow mb-2">Drag a fix (or press +)</p>
          <ul className="max-h-[330px] space-y-1.5 overflow-y-auto pr-1" data-testid="stack-palette">
            {pal.map((f) => {
              const t = FIX_TONE[f.status];
              const div = f.status === "Divert or reject";
              const inS = stack.includes(f.id);
              return (
                <li key={f.id} draggable={!div && !inS} onDragStart={(e) => e.dataTransfer.setData("text/fix", f.id)} onMouseEnter={() => onHover(f.id)} onMouseLeave={() => onHover(null)}
                  className={`flex items-center gap-2 rounded-lg border bg-background px-2 py-1.5 text-xs transition-colors ${div ? "opacity-60" : "cursor-grab hover:bg-accent"} ${hl === f.id ? "ring-2 ring-amber-400" : ""} ${detected.has(f.problem) ? "" : "opacity-80"}`}
                  style={{ borderLeft: `4px solid ${t.color}` }}>
                  {div ? <Ban className="h-3.5 w-3.5 shrink-0 text-rose-600" /> : <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <button type="button" onClick={() => onPin(f.id)} className="min-w-0 flex-1 text-left"><span className="block truncate font-medium">{f.action}</span><span className="block truncate text-[10px] text-muted-foreground">{f.problem_label}{detected.has(f.problem) ? " · detected" : ""}</span></button>
                  {!div && <button data-testid={`stack-add-${f.id}`} aria-label={`Add ${f.action}`} disabled={inS} onClick={() => add(f.id)} className="rounded-full border p-1 hover:bg-primary hover:text-primary-foreground disabled:opacity-30"><Plus className="h-3 w-3" /></button>}
                </li>
              );
            })}
          </ul>
        </div>
        <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.getData("text/fix")); }}
          data-testid="stack-conveyor" className={`relative min-w-0 rounded-2xl border-2 border-dashed p-3 transition-colors ${over ? "border-primary bg-primary/5" : "border-border"}`}>
          <ol className="flex items-stretch gap-3 overflow-x-auto pb-6">
            <Station st={{ ...flow[0], step: "Raw batch" }} i={0} n={0} batch={batch} fixed />
            {steps.map((st, i) => <Station key={st.fix_id} st={st} i={i + 1} n={steps.length} batch={batch} onMove={move} onRemove={(k) => setStack(stack.filter((_, j) => j !== k))} hl={hl} onHover={onHover} />)}
            <Station st={last} i={steps.length + 1} n={0} batch={batch} fixed />
          </ol>
          <div className="pointer-events-none absolute inset-x-3 bottom-3 h-2 rounded-full bg-[repeating-linear-gradient(90deg,hsl(var(--muted-foreground)/.35)_0_10px,transparent_10px_18px)] [animation:conveyor_1.2s_linear_infinite]" aria-hidden />
          {!steps.length && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground"><Factory className="mr-2 h-4 w-4" /> Drop fixes here</p>}
        </div>
      </div>
    </ChartCard>
  );
}
