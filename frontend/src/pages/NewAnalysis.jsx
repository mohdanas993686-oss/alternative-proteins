import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Check, Radio, Upload, Loader2, ArrowRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, BP, fmt, TARGET_LABEL } from "@/lib/api";
import { PageHeader, Section, Term, SourceBadge, Note, StatusBadge } from "@/components/common";
import { SpectrumChart } from "@/components/Charts";
import LabResultsForm from "@/components/LabResultsForm";

const STEPS = ["Sample details", "Scan or upload spectrum", "Lab / rapid-test results", "View report"];

const Stepper = ({ step }) => (
  <ol data-testid="wizard-progress" className="mb-8 grid grid-cols-4 gap-2" aria-label="Progress">
    {STEPS.map((s, i) => (
      <li key={s} aria-current={i === step ? "step" : undefined} className="flex flex-col gap-2">
        <div className={`h-1.5 rounded-full transition-colors duration-500 ${i <= step ? "bg-primary" : "bg-border"}`} />
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < step ? "bg-primary text-primary-foreground" : i === step ? "border-2 border-primary text-primary" : "border text-muted-foreground"}`}>{i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
          <span className={`hidden text-xs font-semibold sm:inline ${i === step ? "" : "text-muted-foreground"}`}>{s}</span>
        </div>
      </li>
    ))}
  </ol>
);

const Field = ({ label, error, children, hint }) => (
  <label className="block space-y-1.5"><span className="text-sm font-semibold">{label}</span>{children}{hint && !error && <span className="block text-xs text-muted-foreground">{hint}</span>}{error && <span role="alert" className="block text-xs text-destructive">{error}</span>}</label>
);

const DetailsStep = ({ form, setForm, next }) => {
  const [err, setErr] = useState({});
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const go = (e) => {
    e.preventDefault();
    const er = {};
    if (!form.byproduct) er.byproduct = "Choose the by-product type.";
    if (!form.supplier.trim()) er.supplier = "Who supplied this sample? (e.g. mill name)";
    if (!form.batch.trim()) er.batch = "Add a batch or lot number so results can be traced.";
    if (!form.sample_date) er.sample_date = "Pick the sampling date.";
    setErr(er);
    if (!Object.keys(er).length) next();
  };
  return (
    <form onSubmit={go} noValidate className="space-y-6">
      <div>
        <p className="mb-2 text-sm font-semibold">By-product type</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Object.entries(BP).map(([k, v]) => (
            <button type="button" key={k} data-testid={`bp-option-${k}`} aria-pressed={form.byproduct === k} onClick={() => setForm({ ...form, byproduct: k })}
              className={`card-hover rounded-xl border-2 p-4 text-left transition-colors ${form.byproduct === k ? "border-primary bg-accent" : "border-border bg-card"}`}>
              <span className="mb-2 block h-2 w-8 rounded-full" style={{ background: v.color }} />
              <span className="font-display font-bold">{v.label}</span>
            </button>
          ))}
        </div>
        {err.byproduct && <p role="alert" className="mt-1 text-xs text-destructive">{err.byproduct}</p>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Sample ID (optional)" hint="Leave blank to auto-generate."><input data-testid="input-sample-code" value={form.sample_code} onChange={set("sample_code")} className="field" placeholder="e.g. GUA-301" /></Field>
        <Field label="Supplier" error={err.supplier}><input data-testid="input-supplier" value={form.supplier} onChange={set("supplier")} className={`field ${err.supplier ? "field-error" : ""}`} placeholder="Mill / processor name" /></Field>
        <Field label="Batch / lot" error={err.batch}><input data-testid="input-batch" value={form.batch} onChange={set("batch")} className={`field ${err.batch ? "field-error" : ""}`} placeholder="e.g. LOT-2026-114" /></Field>
        <Field label="Sampling date" error={err.sample_date}><input data-testid="input-sample-date" type="date" value={form.sample_date} onChange={set("sample_date")} className={`field ${err.sample_date ? "field-error" : ""}`} /></Field>
        <Field label="Storage history" hint="Packaging, location, duration, conditions."><textarea data-testid="input-storage" value={form.storage_history} onChange={set("storage_history")} className="field h-20 py-2" placeholder="e.g. Jute bags, ambient warehouse, 20 days" /></Field>
        <Field label="Notes"><textarea data-testid="input-notes" value={form.notes} onChange={set("notes")} className="field h-20 py-2" /></Field>
      </div>
      <div className="flex justify-end"><button data-testid="wizard-next-1" className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5">Continue <ArrowRight className="h-4 w-4" /></button></div>
    </form>
  );
};

const PredTable = ({ preds }) => (
  <div className="overflow-x-auto">
    <table data-testid="preview-predictions" className="w-full text-sm">
      <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Target</th><th>Predicted</th><th>± error (<Term k="RMSE" />)</th><th>Model</th><th>Source</th></tr></thead>
      <tbody className="divide-y">{preds.map((p) => (
        <tr key={p.target}><td className="py-2 font-medium">{TARGET_LABEL[p.target]}</td><td className="font-mono">{fmt(p.value, 2)}</td><td className="font-mono">± {fmt(p.error, 2)}</td><td className="font-mono text-xs">{p.model}</td>
          <td>{p.reliable ? <SourceBadge source="AI prediction" /> : <span className="text-xs text-amber-700 dark:text-amber-300">Lab assay recommended</span>}</td></tr>
      ))}</tbody>
    </table>
  </div>
);

const ScanStep = ({ form, back, onCreated }) => {
  const [scan, setScan] = useState(null);
  const [preds, setPreds] = useState(null);
  const [busy, setBusy] = useState("");
  const load = async (data) => {
    setScan(data);
    const r = await api.post("/predict", { byproduct: form.byproduct, spectrum: data.spectrum, wavelengths: data.wavelengths });
    setPreds(r.data.predictions);
  };
  const simulate = async () => { setBusy("scan"); try { await load((await api.post("/simulate-scan", { byproduct: form.byproduct })).data); } catch (e) { toast.error(errMsg(e)); } setBusy(""); };
  const upload = async (file) => {
    if (!file) return;
    setBusy("upload");
    const fd = new FormData(); fd.append("file", file);
    try { await load((await api.post("/spectrum/parse", fd)).data); toast.success("Spectrum loaded"); } catch (e) { toast.error(errMsg(e)); }
    setBusy("");
  };
  const save = async () => {
    setBusy("save");
    try { const r = await api.post("/samples", { ...form, sample_code: form.sample_code || null, spectrum: scan?.spectrum, wavelengths: scan?.wavelengths, spectrum_source: scan?.source }); toast.success(`Sample ${r.data.sample_code} saved`); onCreated(r.data); }
    catch (e) { toast.error(errMsg(e)); }
    setBusy("");
  };
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">No real <Term k="NIR">NIR</Term> sensor is connected. Simulate a scan (3 scans averaged, 900–1700 nm) or upload a CSV with columns <code className="rounded bg-secondary px-1">wavelength,absorbance</code>.</p>
      <div className="flex flex-wrap gap-3">
        <button data-testid="simulate-scan-btn" onClick={simulate} disabled={!!busy} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60">{busy === "scan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />} Simulate NIR scan</button>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-ring">
          {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload spectrum CSV
          <input data-testid="upload-spectrum-input" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => upload(e.target.files[0])} />
        </label>
      </div>
      {scan ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border p-3"><p className="eyebrow mb-1">{scan.source}</p><SpectrumChart wavelengths={scan.wavelengths} spectrum={scan.spectrum} /></div>
          <div className="space-y-3">{preds ? <PredTable preds={preds} /> : <Loader2 className="animate-spin" />}<Note tone="warn">Models trained on synthetic data. Predictions are not valid for real samples.</Note></div>
        </div>
      ) : <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No spectrum yet: press "Simulate NIR scan" to generate one.</div>}
      <div className="flex justify-between">
        <button data-testid="wizard-back-2" onClick={back} className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold hover:bg-accent"><ArrowLeft className="h-4 w-4" /> Back</button>
        <button data-testid="wizard-save-sample" onClick={save} disabled={!scan || !!busy} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} Save sample & continue <ArrowRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
};

const ReportStep = ({ sample }) => {
  const [r, setR] = useState(null);
  useEffect(() => { api.get(`/report/${sample.id}`).then((x) => setR(x.data)); }, [sample.id]);
  const nav = useNavigate();
  if (!r) return <Loader2 className="animate-spin" />;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border p-5"><p className="eyebrow">Suitability score</p><p data-testid="wizard-score" className="font-display text-5xl font-extrabold">{r.suitability.score}<span className="text-lg text-muted-foreground">/100</span></p></div>
        <div className="rounded-xl border p-5"><p className="eyebrow mb-2">Screening status</p><StatusBadge status={r.overall_status} testid="wizard-overall-status" /><p className="mt-2 text-xs text-muted-foreground">{r.retests.length} retest / confirmation item(s)</p></div>
        <div className="rounded-xl border p-5"><p className="eyebrow">Safe usable protein</p><p className="font-display text-3xl font-extrabold">{r.suitability.safe_usable_protein_g_per_kg}<span className="text-base text-muted-foreground"> g/kg</span></p></div>
      </div>
      <div className="flex flex-wrap gap-3">
        <button data-testid="wizard-open-report" onClick={() => nav(`/samples/${sample.id}`)} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground">Open full report <ArrowRight className="h-4 w-4" /></button>
        <Link to="/new" reloadDocument data-testid="wizard-start-another" className="rounded-full border px-5 py-2.5 text-sm font-semibold hover:bg-accent">Start another analysis</Link>
      </div>
    </div>
  );
};

export default function NewAnalysis() {
  const [step, setStep] = useState(0);
  const [sample, setSample] = useState(null);
  const [form, setForm] = useState({ byproduct: "", sample_code: "", supplier: "", batch: "", sample_date: new Date().toISOString().slice(0, 10), storage_history: "", notes: "" });
  return (
    <div>
      <PageHeader eyebrow="Wizard" title="New analysis" desc="Four short steps. You can leave lab results for later and add them from the report page." />
      <Stepper step={step} />
      <Section testid={`wizard-step-${step + 1}`} eyebrow={`Step ${step + 1} of 4`} title={STEPS[step]}>
        <div key={step} className="fade-up">
          {step === 0 && <DetailsStep form={form} setForm={setForm} next={() => setStep(1)} />}
          {step === 1 && <ScanStep form={form} back={() => setStep(0)} onCreated={(s) => { setSample(s); setStep(2); }} />}
          {step === 2 && <LabResultsForm sampleId={sample.id} onSaved={() => setStep(3)} onSkip={() => setStep(3)} submitLabel="Save & view report" />}
          {step === 3 && <ReportStep sample={sample} />}
        </div>
      </Section>
    </div>
  );
}
