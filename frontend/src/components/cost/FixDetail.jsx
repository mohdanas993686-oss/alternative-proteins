import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Wrench, FlaskConical, Clock, Coins, Beef, Target, Plus, Minus, UserCheck, Ban } from "lucide-react";
import { FIX_TONE, useMoney } from "@/lib/cost";
import { IllustrativeBadge } from "@/components/ChartCard";

const Bar = ({ value, max, color, label, text, icon: Icon, testid }) => (
  <div data-testid={testid}>
    <div className="mb-1 flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 font-medium"><Icon className="h-3.5 w-3.5" aria-hidden />{label}</span><span className="font-mono font-semibold">{text}</span></div>
    <div className="h-2.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} /></div>
  </div>
);

export const StatusPill = ({ status, testid }) => {
  const t = FIX_TONE[status] || FIX_TONE.Fixable;
  return (
    <span data-testid={testid} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ color: t.color, borderColor: t.color, background: t.soft }}>
      <t.Icon className="h-3 w-3" aria-hidden /> {t.label}
    </span>
  );
};

export function FixMiniCard({ f, all, inStack, onToggle }) {
  const { money } = useMoney();
  const maxC = Math.max(...all.map((x) => x.cost_high), 1);
  const divert = f.status === "Divert or reject";
  return (
    <div data-testid="fix-mini-card" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><StatusPill status={f.status} testid="fix-mini-status" /><IllustrativeBadge /></div>
      <div className="space-y-1">
        <Bar testid="fix-mini-cost" icon={Coins} label="Cost per kg input" value={f.cost_typical} max={maxC} color="#d97706" text={`${money(f.cost_low)}–${money(f.cost_high)}`} />
        <div className="relative h-0"><span className="absolute -top-3.5 h-2.5 w-0.5 bg-foreground/70" style={{ left: `${(f.cost_typical / maxC) * 100}%` }} title="typical" /></div>
      </div>
      {!divert && <>
        <Bar testid="fix-mini-protein" icon={Beef} label="Protein loss" value={f.protein_loss_pct} max={50} color="#b91c1c" text={`−${f.protein_loss_pct}%`} />
        <Bar icon={Target} label="Effectiveness" value={f.effectiveness ?? 0} max={100} color="#15803d" text={f.effectiveness == null ? "n/a" : `${f.effectiveness}%`} />
        <Bar icon={Clock} label="Time" value={Math.log1p(f.time_h)} max={Math.log1p(336)} color="#0369a1" text={f.time_h >= 48 ? `${Math.round(f.time_h / 24)} days` : `${f.time_h} h`} />
      </>}
      <div className="grid gap-2 text-xs">
        <p className="flex items-start gap-2"><Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span><b>Equipment:</b> {f.equipment || "—"}</span></p>
        <div className="flex flex-wrap items-center gap-1.5"><FlaskConical className="h-3.5 w-3.5" aria-hidden /><b>Retest:</b>
          {f.retest.length ? f.retest.map((r) => <span key={r} className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px]">{r}</span>) : <span className="text-muted-foreground">none</span>}</div>
        {f.note && <p className="text-muted-foreground">{f.note}</p>}
      </div>
      {divert ? (
        <p data-testid="fix-mini-divert" className="flex items-center gap-2 rounded-lg border border-rose-600/30 bg-rose-500/10 p-2 text-xs font-semibold text-rose-800 dark:text-rose-300"><Ban className="h-4 w-4" /> Decision, not a process step. Human review required.</p>
      ) : onToggle && (
        <button data-testid="fix-mini-toggle" onClick={() => onToggle(f.id)} className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${inStack ? "border hover:bg-accent" : "bg-primary text-primary-foreground hover:opacity-90"}`}>
          {inStack ? <><Minus className="h-4 w-4" /> Remove from fix stack</> : <><Plus className="h-4 w-4" /> Add to fix stack</>}
        </button>
      )}
      {f.status === "Human review required" && <p className="flex items-center gap-1.5 text-[11px] text-amber-800 dark:text-amber-300"><UserCheck className="h-3.5 w-3.5" /> Needs validation or human review before use.</p>}
    </div>
  );
}

export function FixSheet({ fix, all, stack, onToggle, onClose }) {
  return (
    <Sheet open={!!fix} onOpenChange={(o) => !o && onClose()}>
      <SheetContent data-testid="fix-detail-sheet" className="w-full overflow-y-auto sm:max-w-md">
        {fix && <>
          <SheetHeader className="mb-4 text-left"><SheetTitle className="font-display text-xl">{fix.action}</SheetTitle><SheetDescription>{fix.problem_label}</SheetDescription></SheetHeader>
          <FixMiniCard f={fix} all={all} inStack={stack?.includes(fix.id)} onToggle={onToggle} />
        </>}
      </SheetContent>
    </Sheet>
  );
}
