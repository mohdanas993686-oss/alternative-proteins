import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";

const EMPTY = { name: "", price_low: "", price_typical: "", price_high: "", protein_pct: "", digestibility: "", quality_basis: "", allergen_risk: 1,
  allergen_note: "", flavour: 60, supply: 70, regulatory: 80, price_source: "User entry", price_date: new Date().toISOString().slice(0, 10) };

const F = ({ label, children }) => <label className="block text-xs"><span className="mb-1 block font-medium">{label}</span>{children}</label>;

export default function SourceForm({ source, onSaved }) {
  const [f, setF] = useState(() => (source ? { ...EMPTY, ...source } : EMPTY));
  const [busy, setBusy] = useState(false);
  const set = (k, num) => (e) => setF((o) => ({ ...o, [k]: num ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    if (!(f.price_low <= f.price_typical && f.price_typical <= f.price_high)) return toast.error("Prices must be low ≤ typical ≤ high");
    setBusy(true);
    const body = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, f[k]]));
    try {
      if (source) await api.put(`/conventional/${source.id}`, { ...body, key: source.key });
      else await api.post("/conventional", body);
      toast.success(source ? "Source updated: comparison refreshed" : "Source added: comparison refreshed");
      onSaved();
    } catch (er) { toast.error(errMsg(er)); }
    setBusy(false);
  };
  const num = (k, label, props = {}) => <F label={label}><input data-testid={`src-${k}`} type="number" required min={0} step="any" value={f[k]} onChange={set(k, true)} className="field h-9 font-mono" {...props} /></F>;
  const slider = (k, label) => <F label={<span className="flex justify-between"><span>{label}</span><span className="font-mono">{f[k]}</span></span>}><input data-testid={`src-${k}`} type="range" min={0} max={100} value={f[k]} onChange={set(k, true)} className="w-full accent-primary" /></F>;
  return (
    <form onSubmit={save} data-testid="source-form" className="space-y-4">
      <F label="Name"><input data-testid="src-name" required minLength={2} maxLength={120} value={f.name} onChange={set("name")} className="field h-9" placeholder="e.g. Chickpea protein isolate" /></F>
      <div className="grid grid-cols-3 gap-3">{num("price_low", "Price low (₹/kg)")}{num("price_typical", "Typical (₹/kg)")}{num("price_high", "High (₹/kg)")}</div>
      <div className="grid grid-cols-3 gap-3">
        {num("protein_pct", "Protein %", { max: 100 })}{num("digestibility", "Digestibility (0-1.2)", { max: 1.2 })}
        <F label="Allergen risk"><select data-testid="src-allergen_risk" value={f.allergen_risk} onChange={set("allergen_risk", true)} className="field h-9">
          {["0 · none known", "1 · low", "2 · moderate", "3 · major allergen"].map((l, i) => <option key={i} value={i}>{l}</option>)}</select></F>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <F label="Quality basis"><input data-testid="src-quality_basis" value={f.quality_basis} onChange={set("quality_basis")} className="field h-9" placeholder="e.g. PDCAAS ~0.8" /></F>
        <F label="Allergen note"><input data-testid="src-allergen_note" value={f.allergen_note} onChange={set("allergen_note")} className="field h-9" /></F>
        <F label="Price source"><input data-testid="src-price_source" value={f.price_source} onChange={set("price_source")} className="field h-9" placeholder="Supplier quote, market report…" /></F>
        <F label="Price date"><input data-testid="src-price_date" type="date" value={f.price_date || ""} onChange={set("price_date")} className="field h-9" /></F>
      </div>
      <div className="grid grid-cols-3 gap-3">{slider("flavour", "Flavour")}{slider("supply", "Supply")}{slider("regulatory", "Regulatory")}</div>
      <button data-testid="source-save-btn" type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save source</button>
    </form>
  );
}
