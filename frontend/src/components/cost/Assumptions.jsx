import { useEffect, useState } from "react";
import { Settings2, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { api, errMsg, BP } from "@/lib/api";
import { IllustrativeBadge } from "@/components/ChartCard";

const Num = ({ label, value, onChange, step = "any", testid }) => (
  <label className="block text-xs"><span className="mb-1 block font-medium">{label}</span>
    <input data-testid={testid} type="number" min={0} step={step} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} className="field h-9 font-mono" /></label>
);

const Group = ({ title, children }) => (
  <fieldset className="space-y-3 rounded-xl border p-3"><legend className="px-1 font-display text-sm font-bold">{title}</legend><div className="grid grid-cols-2 gap-3">{children}</div></fieldset>
);

export default function AssumptionsSheet({ onSaved }) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) api.get("/cost/assumptions").then((r) => setA(r.data.assumptions)); }, [open]);
  const set = (path, v) => setA((o) => { const c = structuredClone(o); let t = c; path.slice(0, -1).forEach((k) => { t = t[k]; }); t[path[path.length - 1]] = v; return c; });
  const save = async () => {
    const bad = JSON.stringify(a).includes('""');
    if (bad) return toast.error("Fill in every field (use 0 if not applicable).");
    setBusy(true);
    try { await api.put("/cost/assumptions", { assumptions: a }); toast.success("Assumptions saved: all charts updated"); setOpen(false); onSaved?.(); } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild><button data-testid="assumptions-open-btn" className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-semibold hover:bg-accent"><Settings2 className="h-4 w-4" /> Assumptions</button></SheetTrigger>
      <SheetContent data-testid="assumptions-sheet" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="mb-4 text-left"><SheetTitle className="font-display text-xl">Cost assumptions (INR)</SheetTitle><SheetDescription>Editable placeholders. The agent cannot change these.</SheetDescription><IllustrativeBadge /></SheetHeader>
        {!a ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <div className="space-y-4">
            <Group title="Batch & scale">
              <Num testid="as-batch" label="Default batch size (kg)" value={a.batch_kg} onChange={(v) => set(["batch_kg"], v)} />
              <label className="block text-xs"><span className="mb-1 block font-medium">Scale</span>
                <select data-testid="as-scale" value={a.scale} onChange={(e) => set(["scale"], e.target.value)} className="field h-9">{["auto", "lab", "pilot", "industrial"].map((s) => <option key={s}>{s}</option>)}</select></label>
              {Object.keys(a.scale_multipliers).map((k) => <Num key={k} label={`${k} cost multiplier`} value={a.scale_multipliers[k]} onChange={(v) => set(["scale_multipliers", k], v)} />)}
              <Num label="Failure probability (0-1)" value={a.failure_prob} onChange={(v) => set(["failure_prob"], v)} />
            </Group>
            <Group title="Raw price per kg (low / typical / high)">
              {Object.keys(a.raw_price).map((bp) => <div key={bp} className="col-span-2 grid grid-cols-3 gap-2"><p className="col-span-3 text-xs font-semibold">{BP[bp]?.label}</p>
                {["low", "typical", "high"].map((k) => <Num key={k} testid={`as-raw-${bp}-${k}`} label={k} value={a.raw_price[bp][k]} onChange={(v) => set(["raw_price", bp, k], v)} />)}</div>)}
            </Group>
            <Group title="Testing cost per batch">{Object.keys(a.testing).map((k) => <Num key={k} label={k} value={a.testing[k]} onChange={(v) => set(["testing", k], v)} />)}</Group>
            <Group title="Operating costs">
              {[["labour_per_kg", "Labour / kg input"], ["energy_per_kg", "Energy / kg input"], ["packaging_per_kg", "Packaging / kg product"], ["transport_per_kg", "Transport / kg input"], ["overhead_pct", "Overhead %"], ["diversion_value_per_kg", "Diversion credit / kg (non-food)"]].map(([k, l]) =>
                <Num key={k} label={l} value={a[k]} onChange={(v) => set([k], v)} />)}
            </Group>
            <Group title="Digestibility factor (0-1)">{Object.keys(a.digestibility).map((bp) => <Num key={bp} label={BP[bp]?.label} value={a.digestibility[bp]} onChange={(v) => set(["digestibility", bp], v)} />)}</Group>
            <Group title="Placeholder quality targets">{Object.keys(a.quality_targets).map((k) => <Num key={k} label={k.replace("_", " ")} value={a.quality_targets[k]} onChange={(v) => set(["quality_targets", k], v)} />)}</Group>
            <Group title="Currency rates (per ₹1)">{Object.keys(a.fx_per_inr).map((k) => <Num key={k} label={k} value={a.fx_per_inr[k]} onChange={(v) => set(["fx_per_inr", k], v)} />)}</Group>
            <button data-testid="assumptions-save-btn" onClick={save} disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save assumptions</button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
