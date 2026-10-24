import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { PageHeader, Section, Note, CardSkeleton, StatusBadge, Term } from "@/components/common";

const LABELS = { afb1: "Aflatoxin B1", aflatoxin_total: "Total aflatoxins", apc: "Aerobic plate count", yeast_mould: "Yeast & mould", water_activity: "Water activity", moisture: "Moisture" };

export default function Rules() {
  const [t, setT] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.get("/thresholds").then((r) => setT(r.data.thresholds)); }, []);
  const set = (k, f, v) => setT({ ...t, [k]: { ...t[k], [f]: v } });
  const save = async (e) => {
    e.preventDefault();
    const payload = {};
    for (const [k, v] of Object.entries(t)) {
      payload[k] = {};
      for (const [f, val] of Object.entries(v)) {
        if (f === "unit") continue;
        const n = Number(val);
        if (val === "" || Number.isNaN(n) || n < 0) return toast.error(`${LABELS[k]}: '${f}' must be a positive number`);
        payload[k][f] = n;
      }
    }
    setSaving(true);
    try { const r = await api.put("/thresholds", { thresholds: payload }); setT(r.data.thresholds); toast.success("Thresholds saved; reports will use them immediately"); } catch (e2) { toast.error(errMsg(e2)); }
    setSaving(false);
  };
  return (
    <div>
      <PageHeader eyebrow="Rule engine" title="Safety rules" desc="Configurable thresholds used to output PASS / REVIEW / RETEST / FAIL flags." />
      <div className="mb-6"><Note tone="warn" testid="fssai-note">Placeholder values only. Check current FSSAI requirements (and buyer specifications) before using any limit.</Note></div>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Section testid="thresholds-form-section" title="Thresholds">
          {!t ? <CardSkeleton /> : (
            <form onSubmit={save} className="space-y-4" noValidate>
              {Object.entries(t).map(([k, v]) => (
                <div key={k} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1.2fr_1fr_1fr] sm:items-center">
                  <p className="text-sm font-semibold">{LABELS[k] || k} <span className="text-xs font-normal text-muted-foreground">({v.unit})</span></p>
                  {Object.entries(v).filter(([f]) => f !== "unit").map(([f, val]) => (
                    <label key={f} className="text-xs"><span className="mb-1 block capitalize text-muted-foreground">{f}</span>
                      <input data-testid={`threshold-${k}-${f}`} type="number" step="any" value={val} onChange={(e) => set(k, f, e.target.value)} className="field" /></label>
                  ))}
                </div>
              ))}
              <button data-testid="save-thresholds-btn" disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save thresholds</button>
            </form>
          )}
        </Section>
        <Section testid="rules-explainer" title="How flags are decided">
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3"><StatusBadge status="PASS" testid="legend-pass" /><span>Below limit by the test entered. Never means "safe".</span></li>
            <li className="flex gap-3"><StatusBadge status="REVIEW" testid="legend-review" /><span>Above review level, inherent allergen, or confirmation pending: a person must assess.</span></li>
            <li className="flex gap-3"><StatusBadge status="RETEST" testid="legend-retest" /><span>Missing test, screening result (ELISA / rapid) near or above limit, presumptive positive, or inconsistent entries.</span></li>
            <li className="flex gap-3"><StatusBadge status="FAIL" testid="legend-fail" /><span>Confirmatory result (e.g. <Term k="HPLC" />, confirmed pathogen) above limit.</span></li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">Aflatoxin: ≤ 50% of limit → PASS; 50–100% → REVIEW (HPLC) or RETEST (screening); above limit → FAIL (HPLC) or RETEST (screening). Microbial counts and water activity use review / fail levels.</p>
        </Section>
      </div>
    </div>
  );
}
