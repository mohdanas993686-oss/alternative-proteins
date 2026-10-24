import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Term } from "@/components/common";

const NUM = {
  composition: [["protein", "Crude protein", "% DM", ["Kjeldahl", "Dumas"]], ["oil", "Residual oil", "% DM", ["Soxhlet"]],
    ["moisture", "Moisture", "%", ["Oven drying"]], ["fibre_total", "Total dietary fibre", "% DM", ["AOAC enzymatic-gravimetric"]]],
  anf: [["phytate", "Phytate", "mg/g", ["Spectrophotometric", "HPLC"]], ["tannins", "Tannins", "mg/g", ["Folin-Ciocalteu", "Vanillin-HCl"]],
    ["trypsin_inhibitor", "Trypsin-inhibitor activity", "TIU/mg", ["Enzymatic assay"]], ["lectins", "Lectins (optional)", "HU/mg", ["Haemagglutination"]],
    ["saponins", "Saponins (optional)", "mg/g", ["Spectrophotometric", "HPLC"]]],
  aflatoxin: [["afb1", "Aflatoxin B1", "µg/kg", ["ELISA", "Rapid test (lateral flow)", "HPLC"]], ["aflatoxin_total", "Total aflatoxins", "µg/kg", ["ELISA", "Rapid test (lateral flow)", "HPLC"]]],
  micro: [["apc", "Aerobic plate count", "cfu/g", ["Plate count"]], ["yeast_mould", "Yeast & mould", "cfu/g", ["Plate count"]], ["water_activity", "Water activity", "aw (0-1)", ["Dew-point meter", "Capacitance"]]],
};
const PATH = [["salmonella", "Salmonella spp."], ["e_coli", "E. coli"], ["listeria", "Listeria (optional)"]];
const ALG = [["allergen_peanut", "Peanut"], ["allergen_almond", "Almond"], ["allergen_pulse", "Pulse-specific"]];

const Sel = ({ value, onChange, options, testid, label }) => (
  <select data-testid={testid} aria-label={label} value={value || ""} onChange={(e) => onChange(e.target.value)} className="field">
    <option value="">—</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);

const NumRow = ({ k, label, unit, methods, v, set, err }) => (
  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.2fr_1fr_1fr] sm:items-center">
    <label htmlFor={`lab-${k}`} className="text-sm font-medium">{label} <span className="text-xs text-muted-foreground">({unit})</span></label>
    <div>
      <input id={`lab-${k}`} data-testid={`lab-input-${k}`} type="number" step="any" inputMode="decimal" value={v[k]?.value ?? ""} onChange={(e) => set(k, { value: e.target.value })} className={`field ${err[k] ? "field-error" : ""}`} placeholder="value" />
      {err[k] && <p className="mt-1 text-xs text-destructive" role="alert">{err[k]}</p>}
    </div>
    <Sel testid={`lab-method-${k}`} label={`${label} method`} value={v[k]?.method || (methods.length === 1 ? methods[0] : "")} onChange={(m) => set(k, { method: m })} options={methods} />
  </div>
);

const Group = ({ title, children, hint }) => (
  <fieldset className="space-y-3 rounded-xl border p-4">
    <legend className="px-1 font-display text-base font-bold">{title}</legend>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    {children}
  </fieldset>
);

export default function LabResultsForm({ sampleId, onSaved, onSkip, submitLabel = "Save lab results" }) {
  const [v, setV] = useState({});
  const [err, setErr] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k, patch) => setV((s) => ({ ...s, [k]: { ...s[k], ...patch } }));
  const allNum = Object.values(NUM).flat();

  const submit = async (e) => {
    e.preventDefault();
    const errors = {}, results = [];
    for (const [k, , unit, methods] of allNum) {
      const raw = v[k]?.value;
      if (raw === undefined || raw === "") continue;
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0) errors[k] = "Please enter a positive number.";
      else if (k === "water_activity" && n > 1) errors[k] = "Water activity is between 0 and 1.";
      else results.push({ target: k, value: n, unit, method: v[k]?.method || (methods.length === 1 ? methods[0] : null) });
    }
    for (const [k] of PATH) if (v[k]?.result) results.push({ target: k, result: v[k].result, method: v[k].method || null, confirmation: v[k].confirmation || "Pending" });
    for (const [k] of ALG) if (v[k]?.result) results.push({ target: k, result: v[k].result, method: v[k].method || null });
    for (const k of ["cross_contact", "supplier_notes"]) if (v[k]?.notes?.trim()) results.push({ target: k, notes: v[k].notes.trim() });
    setErr(errors);
    if (Object.keys(errors).length) return toast.error("Some values need fixing before saving.");
    if (!results.length) return toast.error("Enter at least one result, or skip this step.");
    setSaving(true);
    try { await api.post("/lab-results", { sample_id: sampleId, results }); toast.success(`${results.length} result(s) saved`); setV({}); onSaved?.(); }
    catch (e2) { toast.error(errMsg(e2)); }
    setSaving(false);
  };

  return (
    <form onSubmit={submit} data-testid="lab-results-form" className="space-y-5" noValidate>
      <p className="text-sm text-muted-foreground">Fill in only what you have. Each value is stored as a separate reference result. Entries are rule-checked, not certified.</p>
      <div className="grid gap-5 xl:grid-cols-2">
        <Group title="Composition reference" hint={<>Lab values override AI predictions in the report (e.g. <Term k="Kjeldahl" /> protein).</>}>{NUM.composition.map(([k, l, u, m]) => <NumRow key={k} {...{ k, label: l, unit: u, methods: m, v, set, err }} />)}</Group>
        <Group title={<>Anti-nutritional factors (<Term k="ANF">ANF</Term>)</>} hint="Lab assay recommended: NIR predictions are unreliable for these targets.">{NUM.anf.map(([k, l, u, m]) => <NumRow key={k} {...{ k, label: l, unit: u, methods: m, v, set, err }} />)}</Group>
        <Group title={<><Term k="Aflatoxin" /> screening</>} hint="ELISA / rapid tests are screening only: results near or above limit will be flagged for HPLC confirmation.">{NUM.aflatoxin.map(([k, l, u, m]) => <NumRow key={k} {...{ k, label: l, unit: u, methods: m, v, set, err }} />)}</Group>
        <Group title="Microbial quality" hint={<>Counts in <Term k="cfu" />; <Term k="Water activity" /> from 0 to 1.</>}>{NUM.micro.map(([k, l, u, m]) => <NumRow key={k} {...{ k, label: l, unit: u, methods: m, v, set, err }} />)}</Group>
        <Group title="Microbial safety (pathogens)" hint="'Not detected' means not detected by this test only.">
          {PATH.map(([k, l]) => (
            <div key={k} className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-center">
              <span className="text-sm font-medium">{l}</span>
              <select data-testid={`lab-result-${k}`} aria-label={`${l} result`} value={v[k]?.result || ""} onChange={(e) => set(k, { result: e.target.value })} className="field">
                <option value="">Result…</option><option value="not_detected">Not detected by this test</option><option value="detected">Detected</option><option value="inconclusive">Inconclusive</option>
              </select>
              <Sel testid={`lab-method-${k}`} label={`${l} method`} value={v[k]?.method} onChange={(m) => set(k, { method: m })} options={["Culture", "PCR", "Immunoassay"]} />
              <Sel testid={`lab-confirm-${k}`} label={`${l} confirmation`} value={v[k]?.confirmation} onChange={(m) => set(k, { confirmation: m })} options={["Presumptive", "Confirmed", "Pending"]} />
            </div>
          ))}
        </Group>
        <Group title="Allergens" hint="Record test results and supply-chain information.">
          {ALG.map(([k, l]) => (
            <div key={k} className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:items-center">
              <span className="text-sm font-medium">{l}</span>
              <select data-testid={`lab-result-${k}`} aria-label={`${l} allergen result`} value={v[k]?.result || ""} onChange={(e) => set(k, { result: e.target.value })} className="field">
                <option value="">Result…</option><option value="not_detected">Not detected by this test</option><option value="detected">Detected</option>
              </select>
              <Sel testid={`lab-method-${k}`} label={`${l} method`} value={v[k]?.method} onChange={(m) => set(k, { method: m })} options={["ELISA", "LC-MS/MS", "PCR", "Supply-chain verification"]} />
            </div>
          ))}
          <textarea data-testid="lab-notes-cross_contact" aria-label="Cross-contact notes" placeholder="Cross-contact notes (shared lines, cleaning records…)" value={v.cross_contact?.notes || ""} onChange={(e) => set("cross_contact", { notes: e.target.value })} className="field h-16 py-2" />
          <textarea data-testid="lab-notes-supplier_notes" aria-label="Supplier notes" placeholder="Supplier notes / declarations" value={v.supplier_notes?.notes || ""} onChange={(e) => set("supplier_notes", { notes: e.target.value })} className="field h-16 py-2" />
        </Group>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {onSkip && <button type="button" data-testid="lab-skip-btn" onClick={onSkip} className="rounded-full border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-accent">Skip for now</button>}
        <button data-testid="lab-submit-btn" disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {submitLabel}
        </button>
      </div>
    </form>
  );
}
