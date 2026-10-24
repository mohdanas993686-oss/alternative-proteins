import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Upload, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, API, errMsg, fmt, BP, TARGET_LABEL } from "@/lib/api";
import { PageHeader, Section, CardSkeleton, Note, Term } from "@/components/common";
import { Plot } from "@/components/Charts";
import { Progress } from "@/components/ui/progress";

const ALGO_COL = { PLSR: "#15803d", SVR: "#d97706", RandomForest: "#0369a1" };

const Scatter = ({ best, target, bp }) => {
  const m = best[`${target}|${bp}`];
  if (!m) return <p className="text-sm text-muted-foreground">No model for this combination.</p>;
  const all = [...m.measured, ...m.predicted];
  const lo = Math.min(...all), hi = Math.max(...all);
  return (
    <Plot testid="pred-vs-measured-plot" height={340} data={[
      { x: [lo, hi], y: [lo, hi], mode: "lines", name: "1:1 line", line: { dash: "dash", color: "#78716c" } },
      { x: m.measured, y: m.predicted, mode: "markers", name: `Test set (${m.algo})`, marker: { size: 10, color: BP[bp].color, line: { width: 1, color: "#fff" } }, hovertemplate: "measured %{x:.2f}<br>predicted %{y:.2f}<extra></extra>" }]}
      layout={{ xaxis: { title: { text: "Measured (synthetic reference)" } }, yaxis: { title: { text: "Predicted" } } }} />
  );
};

const Trainer = ({ onDone }) => {
  const [st, setSt] = useState(null);
  const timer = useRef(null);
  const poll = () => api.get("/train/status").then((r) => {
    setSt(r.data);
    if (r.data.status === "running") timer.current = setTimeout(poll, 1000);
    else if (r.data.status === "completed" && timer.current) { toast.success("Retraining complete"); timer.current = null; onDone(); }
    else if (r.data.status === "failed") toast.error(r.data.message);
  });
  useEffect(() => { poll(); return () => clearTimeout(timer.current); }, []); // eslint-disable-line
  const start = async () => { try { await api.post("/train"); timer.current = 1; poll(); } catch (e) { toast.error(errMsg(e)); } };
  const running = st?.status === "running";
  return (
    <div className="space-y-3">
      <button data-testid="retrain-model-btn" onClick={start} disabled={running} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60">
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {running ? "Training…" : "Retrain model"}
      </button>
      {st && st.status !== "idle" && (
        <div data-testid="train-progress" className="space-y-1"><Progress value={(st.progress || 0) * 100} /><p className="font-mono text-xs text-muted-foreground">{Math.round((st.progress || 0) * 100)}% · {st.message}</p></div>
      )}
    </div>
  );
};

const CsvUpload = () => {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("evaluate");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!file) return toast.error("Choose a CSV file first.");
    setBusy(true); const fd = new FormData(); fd.append("file", file); fd.append("mode", mode);
    try { setRes((await api.post("/train/upload", fd)).data); } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  const rows = res ? (res.mode === "train" ? res.results.filter((r) => r.selected) : res.results) : [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">CSV columns: <code className="rounded bg-secondary px-1 text-xs">sample_id, batch_id, byproduct, protein, oil, …, 900.0 … 1700.0</code>. <a data-testid="download-template-link" href={`${API}/train/template`} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"><Download className="h-3.5 w-3.5" />Download template</a></p>
      <div className="flex flex-wrap items-center gap-2">
        <input data-testid="csv-upload-input" type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-secondary file:px-4 file:py-2 file:text-sm file:font-semibold" />
        <select data-testid="csv-mode-select" aria-label="Upload mode" value={mode} onChange={(e) => setMode(e.target.value)} className="field w-auto"><option value="evaluate">Evaluate current models</option><option value="train">Train sandbox model</option></select>
        <button data-testid="csv-upload-submit" onClick={go} disabled={busy} className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold hover:bg-accent">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Run</button>
      </div>
      {res && (
        <div data-testid="csv-upload-results" className="overflow-x-auto">
          <p className="mb-2 text-xs text-muted-foreground">{res.n_rows} rows · {res.note || "Evaluated against current production models."}</p>
          <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1">Target</th><th>By-product</th><th>Algo</th><th>RMSE</th><th>R²</th><th>Bias</th></tr></thead>
            <tbody className="divide-y">{rows.slice(0, 40).map((r, i) => <tr key={i}><td className="py-1">{TARGET_LABEL[r.target]}</td><td>{BP[r.byproduct]?.label}</td><td>{r.algo || "current"}</td><td className="font-mono">{fmt(r.rmse, 3)}</td><td className="font-mono">{fmt(r.r2, 2)}</td><td className="font-mono">{fmt(r.bias, 3)}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
};

export default function ModelPerformance() {
  const [m, setM] = useState(null);
  const [target, setTarget] = useState("protein");
  const [bp, setBp] = useState("guar_meal");
  const load = () => api.get("/model/metrics").then((r) => setM(r.data));
  useEffect(() => { load(); }, []);
  const best = useMemo(() => m?.best || {}, [m]);
  const targets = useMemo(() => [...new Set(Object.keys(best).map((k) => k.split("|")[0]))], [best]);
  const compare = useMemo(() => {
    if (!m) return [];
    return ["PLSR", "SVR", "RandomForest"].map((a) => ({
      type: "bar", name: a, marker: { color: ALGO_COL[a] }, x: targets.map((t) => TARGET_LABEL[t]),
      y: targets.map((t) => { const rs = m.results.filter((r) => r.algo === a && r.target === t); return rs.reduce((s, r) => s + Math.max(r.r2, -0.5), 0) / (rs.length || 1); }),
    }));
  }, [m, targets]);

  return (
    <div>
      <PageHeader eyebrow="Machine learning" title="Model performance" desc={<>Separate models per target and per by-product. <Term k="PLSR" /> baseline vs SVR vs Random Forest after <Term k="SNV" /> + <Term k="Savitzky-Golay" /> preprocessing; split by batch with a 20% independent test set.</>} actions={<Trainer onDone={load} />} />
      <div className="mb-6"><Note tone="warn" testid="synthetic-model-note">Trained on synthetic data. Metrics are not scientifically valid for real samples.</Note></div>
      {!m ? <CardSkeleton rows={6} /> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-4">
            {[["Samples", m.n_samples], ["Wavelengths", m.n_wavelengths], ["Models selected", Object.keys(best).length], ["Trained", new Date(m.trained_at).toLocaleString()]].map(([k, v]) => (
              <div key={k} className="card-surface p-4"><p className="eyebrow">{k}</p><p data-testid={`model-stat-${k.toLowerCase().replace(/\s/g, "-")}`} className="mt-1 font-display text-2xl font-bold">{v}</p></div>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section testid="pred-vs-measured-section" eyebrow="Independent test set" title="Predicted vs measured"
              right={<div className="flex gap-2">
                <select data-testid="pvm-target-select" aria-label="Target" value={target} onChange={(e) => setTarget(e.target.value)} className="field h-9 w-auto text-xs">{targets.map((t) => <option key={t} value={t}>{TARGET_LABEL[t]}</option>)}</select>
                <select data-testid="pvm-byproduct-select" aria-label="By-product" value={bp} onChange={(e) => setBp(e.target.value)} className="field h-9 w-auto text-xs">{Object.entries(BP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              </div>}>
              <Scatter best={best} target={target} bp={bp} />
              {best[`${target}|${bp}`] && (() => { const b = best[`${target}|${bp}`]; return <p className="font-mono text-xs text-muted-foreground">{b.algo} · RMSE {fmt(b.rmse, 3)} · R² {fmt(b.r2, 2)} · bias {fmt(b.bias, 3)} · n_test {b.n_test} · {b.reliable ? "adequate accuracy" : "inadequate: lab assay recommended"}</p>; })()}
            </Section>
            <Section testid="model-comparison-section" eyebrow="Algorithms" title={<>Model comparison (mean test <Term k="R²" />)</>}>
              <Plot testid="model-comparison-chart" height={360} data={compare} layout={{ barmode: "group", yaxis: { title: { text: "R² (floored at -0.5)" }, range: [-0.5, 1] }, margin: { l: 52, r: 10, t: 10, b: 90 } }} />
            </Section>
          </div>
          <Section testid="metrics-table-section" eyebrow="Selected models" title="Metrics by target & by-product">
            <div className="max-h-[480px] overflow-auto">
              <table data-testid="metrics-table" className="w-full min-w-[720px] text-sm">
                <thead className="sticky top-0 bg-card"><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Target</th><th>By-product</th><th>Best model</th><th><Term k="RMSE" /></th><th>MAE</th><th><Term k="R²" /></th><th><Term k="Bias" /></th><th>Accuracy</th></tr></thead>
                <tbody className="divide-y">{Object.values(best).map((b) => (
                  <tr key={`${b.target}${b.byproduct}`}><td className="py-2">{TARGET_LABEL[b.target]}</td><td>{BP[b.byproduct].label}</td><td className="font-mono text-xs">{b.algo}{b.n_components ? ` (${b.n_components} LV)` : ""}</td><td className="font-mono">{fmt(b.rmse, 3)}</td><td className="font-mono">{fmt(b.mae, 3)}</td><td className="font-mono">{fmt(b.r2, 2)}</td><td className="font-mono">{fmt(b.bias, 3)}</td>
                    <td>{b.reliable ? <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Adequate</span> : <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Lab assay recommended</span>}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </Section>
          <Section testid="csv-upload-section" eyebrow="Your data" title="Upload CSV to train or evaluate"><CsvUpload /></Section>
        </div>
      )}
    </div>
  );
}
