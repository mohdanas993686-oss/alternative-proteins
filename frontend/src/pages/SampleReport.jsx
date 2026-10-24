import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Download, FlaskConical, UserCheck, ArrowLeft, Calculator, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api, API, errMsg, fmt } from "@/lib/api";
import { PageHeader, Section, CardSkeleton, StatusBadge, SourceBadge, Term, Note, Empty } from "@/components/common";
import { SpectrumChart, Plot } from "@/components/Charts";
import AgentPanel from "@/components/AgentPanel";
import LabResultsForm from "@/components/LabResultsForm";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const Meta = ({ s }) => (
  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
    {[["Sample ID", s.sample_code], ["By-product", s.byproduct_label], ["Supplier", s.supplier], ["Batch", s.batch], ["Date", s.sample_date], ["Spectrum", s.spectrum_source || "None"]].map(([k, v]) => (
      <div key={k}><dt className="eyebrow">{k}</dt><dd data-testid={`meta-${k.toLowerCase().replace(/\s/g, "-")}`} className="font-medium">{v}</dd></div>
    ))}
    <div className="col-span-2 md:col-span-3"><dt className="eyebrow">Storage history</dt><dd className="font-medium">{s.storage_history || "—"}</dd></div>
  </dl>
);

const ScoreCard = ({ sc, overall }) => (
  <Section testid="suitability-score-card" eyebrow="Protein ingredient" title="Suitability score">
    <div className="flex items-end gap-4">
      <p data-testid="suitability-score" className="font-display text-6xl font-extrabold leading-none">{sc.score}</p>
      <div className="pb-1 text-sm text-muted-foreground">/ 100<br />base {sc.base_score} × safety {sc.safety_multiplier}</div>
    </div>
    <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${sc.score}%` }} /></div>
    <p className="mt-4 text-sm"><b>{sc.safe_usable_protein_g_per_kg} g/kg</b> safe usable protein · screening <StatusBadge status={overall} testid="overall-status-badge" /></p>
    <details className="mt-4 rounded-xl border bg-background/50 p-3 text-sm" data-testid="score-explanation">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Calculator className="h-4 w-4" /> How is this calculated?</summary>
      <p className="mt-2 text-xs text-muted-foreground">{sc.explanation}</p>
      <table className="mt-3 w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th>Component</th><th>Weight</th><th>Score</th><th>Rule</th></tr></thead>
        <tbody>{sc.components.map((c) => <tr key={c.name} className="border-t"><td className="py-1.5">{c.name}</td><td>{c.weight * 100}%</td><td className="font-mono">{c.score}</td><td className="font-mono text-[10px]">{c.rule}</td></tr>)}</tbody></table>
    </details>
  </Section>
);

const ValueTable = ({ items, testid }) => (
  <div className="overflow-x-auto">
    <table data-testid={testid} className="w-full text-sm">
      <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Target</th><th>Value</th><th>± error</th><th>Source</th><th className="hidden md:table-cell">Note</th></tr></thead>
      <tbody className="divide-y">{items.map((c) => (
        <tr key={c.key} data-testid={`row-${c.key}`}>
          <td className="py-2.5 font-medium">{c.label}</td>
          <td className="font-mono">{fmt(c.value, 2)} <span className="text-xs text-muted-foreground">{c.unit}</span></td>
          <td className="font-mono text-xs">{c.source === "AI prediction" ? `± ${fmt(c.error, 2)}` : "—"}</td>
          <td><SourceBadge source={c.source} /></td>
          <td className="hidden text-xs md:table-cell">{c.lab_assay_recommended ? <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3 w-3" />Lab assay recommended: NIR prediction is unreliable for this target</span> : c.lab_method ? `Method: ${c.lab_method}` : c.source === "AI prediction" ? <>validation <Term k="R²" /> {fmt(c.r2, 2)} · {c.model}</> : ""}</td>
        </tr>
      ))}</tbody>
    </table>
  </div>
);

const FlagsTable = ({ flags, category }) => {
  const fs = flags.filter((f) => category.includes(f.category));
  if (!fs.length) return <p className="text-sm text-muted-foreground">No entries.</p>;
  return (
    <ul className="divide-y">
      {fs.map((f) => (
        <li key={f.key} data-testid={`flag-${f.key}`} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div><p className="text-sm font-semibold">{f.label} {f.value && <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{f.value}{f.method ? ` · ${f.method}` : ""}</span>}</p><p className="text-xs text-muted-foreground">{f.message}</p></div>
          <StatusBadge status={f.status} testid={`flag-status-${f.key}`} />
        </li>
      ))}
    </ul>
  );
};

export default function SampleReport() {
  const { id } = useParams();
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  const [labOpen, setLabOpen] = useState(false);
  const load = useCallback(() => api.get(`/report/${id}`).then((x) => setR(x.data)).catch((e) => setErr(errMsg(e))), [id]);
  useEffect(() => { load(); }, [load]);
  const review = async () => { try { await api.post(`/samples/${id}/review`, { note: "Escalated from report page" }); toast.success("Escalated to a human reviewer"); load(); } catch (e) { toast.error(errMsg(e)); } };

  if (err) return <Empty title="Sample not found" hint={err} action={<Link to="/samples" className="text-sm font-semibold text-primary">Back to samples</Link>} />;
  if (!r) return <div className="grid gap-4"><CardSkeleton rows={4} /><CardSkeleton rows={6} /></div>;
  const s = r.sample;
  const comp = r.composition.filter((c) => ["protein", "oil", "moisture", "fibre_total", "fibre_soluble", "fibre_insoluble", "gum"].includes(c.key) && c.value != null);
  const pending = s.review_status === "pending_human_review";

  return (
    <div>
      <Link to="/samples" data-testid="back-to-samples" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Samples</Link>
      <PageHeader eyebrow="Sample report" title={s.sample_code} desc={`${s.byproduct_label} · ${s.supplier}`}
        actions={<>
          <Dialog open={labOpen} onOpenChange={setLabOpen}>
            <DialogTrigger asChild><button data-testid="add-lab-results-btn" className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-semibold hover:bg-accent"><FlaskConical className="h-4 w-4" /> Add lab results</button></DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto"><DialogHeader><DialogTitle>Lab / rapid-test results for {s.sample_code}</DialogTitle></DialogHeader><LabResultsForm sampleId={id} onSaved={() => { setLabOpen(false); load(); }} /></DialogContent>
          </Dialog>
          <a data-testid="export-pdf-btn" href={`${API}/report/${id}/pdf`} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"><Download className="h-4 w-4" /> Export PDF</a>
        </>} />

      {r.human_review_required && (
        <div data-testid="human-review-banner" className="fade-up mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-600/30 bg-rose-500/10 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-rose-900 dark:text-rose-200"><UserCheck className="h-5 w-5" /> Positive, uncertain or failing results present: this sample must be checked by a human reviewer.</p>
          <button data-testid="report-human-review-btn" disabled={pending} onClick={review} className="rounded-full bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-800 disabled:opacity-60">{pending ? "Review requested" : "Human review required"}</button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <Section testid="sample-meta" eyebrow="Details" title="Sample"><Meta s={s} /></Section>
            <ScoreCard sc={r.suitability} overall={r.overall_status} />
          </div>
          <Section testid="composition-section" eyebrow="Module A" title={<>Composition profile (<Term k="NIR">NIR</Term> + lab)</>}>
            <div className="grid gap-6 lg:grid-cols-2">
              {r.spectrum ? <SpectrumChart wavelengths={r.wavelengths} spectrum={r.spectrum} height={260} /> : <Empty title="No spectrum" hint="Upload or simulate a scan to get AI predictions." />}
              <Plot testid="composition-bars" height={260} data={[{ type: "bar", orientation: "h", y: comp.map((c) => c.label), x: comp.map((c) => c.value), error_x: { type: "data", array: comp.map((c) => (c.source === "AI prediction" ? c.error : 0)), color: "#78716c" }, marker: { color: comp.map((c) => (c.source === "Lab measured" ? "#0369a1" : "#15803d")) }, hovertemplate: "%{y}: %{x:.2f}<extra></extra>" }]}
                layout={{ margin: { l: 140, r: 10, t: 10, b: 40 }, xaxis: { title: { text: "% (DM)" } }, showlegend: false }} />
            </div>
            <div className="mt-4"><ValueTable items={r.composition} testid="composition-table" /></div>
          </Section>
          <Section testid="anf-section" eyebrow="Module B" title={<>Anti-nutritional factors (<Term k="ANF">ANF</Term>)</>}>
            <Note tone="warn">Each ANF is a separate target. NIR validation accuracy is inadequate for these on current (synthetic) models, so lab assays are recommended.</Note>
            <div className="mt-3"><ValueTable items={r.anf} testid="anf-table" /></div>
          </Section>
          <Section testid="safety-section" eyebrow="Module C · rule-based, not certification" title="Food-safety screening" right={<StatusBadge status={r.overall_status} testid="safety-overall-badge" />}>
            <Note>Placeholder thresholds: check current FSSAI requirements. <Link className="font-semibold underline" to="/rules">Edit rules</Link>. "Not detected" means not detected by this test.</Note>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <div><h3 className="mb-1 font-display font-bold"><Term k="Aflatoxin" /></h3><FlagsTable flags={r.safety_flags} category={["Aflatoxin"]} /></div>
              <div><h3 className="mb-1 font-display font-bold">Microbial quality</h3><FlagsTable flags={r.safety_flags} category={["Microbial quality"]} /></div>
              <div><h3 className="mb-1 font-display font-bold">Microbial safety</h3><FlagsTable flags={r.safety_flags} category={["Microbial safety"]} /></div>
              <div><h3 className="mb-1 font-display font-bold">Allergen risk</h3><FlagsTable flags={r.safety_flags} category={["Allergens"]} />
                {Object.entries(r.allergen_notes).map(([k, n]) => n && <p key={k} className="mt-2 rounded-lg bg-secondary p-2 text-xs"><b>{k === "cross_contact" ? "Cross-contact" : "Supplier"}:</b> {n}</p>)}</div>
            </div>
          </Section>
          <Section testid="retests-section" eyebrow="Actions" title="Retest flags & missing data">
            <div className="grid gap-6 lg:grid-cols-2">
              <ul className="space-y-2">{r.anomalies.map((a, i) => <li key={i} className="rounded-lg border border-orange-600/30 bg-orange-500/10 p-2 text-xs"><b>Anomaly:</b> {a.message}</li>)}
                {r.retests.length === 0 ? <p className="text-sm text-muted-foreground">No retests proposed.</p> : r.retests.map((x, i) => <li key={i} data-testid="retest-item" className="flex items-start justify-between gap-2 rounded-lg border p-2 text-xs"><span><b>{x.test}</b>: {x.reason}</span><StatusBadge status={x.status} testid={`retest-status-${i}`} /></li>)}</ul>
              <ul className="space-y-2">{r.missing.length === 0 ? <p className="text-sm text-muted-foreground">Report is complete.</p> : r.missing.map((m) => <li key={m.target} data-testid={`missing-${m.target}`} className="rounded-lg bg-secondary p-2 text-xs"><b>{m.label}</b> · {m.why}</li>)}</ul>
            </div>
          </Section>
        </div>
        <aside className="xl:sticky xl:top-36 xl:self-start"><Section testid="sample-agent-section"><AgentPanel sampleId={id} onReviewed={load} compact /></Section></aside>
      </div>
    </div>
  );
}
