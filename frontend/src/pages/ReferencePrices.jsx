import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Pencil, Trash2, Upload, FileDown, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { api, API, errMsg } from "@/lib/api";
import { PageHeader, CardSkeleton, Note, Section } from "@/components/common";
import { IllustrativeBadge } from "@/components/ChartCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import ComparisonSection from "@/components/cost/Comparison";
import SourceForm from "@/components/cost/SourceForm";
import AssumptionsSheet from "@/components/cost/Assumptions";
import { CurrencySelect, useMoney } from "@/lib/cost";

const PriceBar = ({ s, max }) => {
  const { money } = useMoney();
  const p = (v) => `${(v / max) * 100}%`;
  return (
    <div className="min-w-[160px]">
      <div className="relative h-2.5 rounded-full bg-secondary" aria-hidden>
        <div className="absolute inset-y-0 rounded-full bg-slate-500/50" style={{ left: p(s.price_low), width: `${((s.price_high - s.price_low) / max) * 100}%` }} />
        <span className="absolute -top-0.5 h-3.5 w-1 rounded bg-slate-800 dark:bg-slate-200" style={{ left: p(s.price_typical) }} />
      </div>
      <p className="mt-1 font-mono text-[11px]">{money(s.price_low)}–{money(s.price_high)} <span className="text-muted-foreground">· typ {money(s.price_typical)}</span></p>
    </div>
  );
};

const Meter = ({ v, max = 100, color }) => <div className="h-1.5 w-16 rounded-full bg-secondary"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (v / max) * 100)}%`, background: color }} /></div>;

const Row = ({ s, max, onEdit, onDelete }) => (
  <tr data-testid={`source-row-${s.key}`} className="align-middle">
    <td className="py-3 pr-3"><p className="text-sm font-semibold">{s.name}</p><p className="text-[11px] text-muted-foreground">{s.price_source} · {s.price_date}{s.placeholder ? " · placeholder" : ""}</p></td>
    <td className="pr-3"><PriceBar s={s} max={max} /></td>
    <td className="pr-3"><span className="font-mono text-xs">{s.protein_pct}%</span><Meter v={s.protein_pct} color="#15803d" /></td>
    <td className="pr-3"><span className="font-mono text-xs">{s.digestibility}</span><Meter v={s.digestibility} max={1} color="#0369a1" /></td>
    <td className="pr-3"><span className="font-mono text-xs">{s.allergen_risk}/3</span><Meter v={s.allergen_risk} max={3} color="#b91c1c" /></td>
    <td className="whitespace-nowrap text-right">
      <button data-testid={`source-edit-${s.key}`} aria-label={`Edit ${s.name}`} onClick={() => onEdit(s)} className="rounded-lg p-2 hover:bg-accent"><Pencil className="h-4 w-4" /></button>
      <button data-testid={`source-delete-${s.key}`} aria-label={`Delete ${s.name}`} onClick={() => onDelete(s)} className="rounded-lg p-2 hover:bg-accent hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
    </td>
  </tr>
);

export default function ReferencePrices() {
  const [src, setSrc] = useState(null);
  const [comp, setComp] = useState(null);
  const [live, setLive] = useState(null);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [rev, setRev] = useState(0);
  const file = useRef(null);
  useEffect(() => { api.get("/prices/live").then((r) => setLive(r.data)); }, []);
  useEffect(() => { api.get("/conventional").then((r) => setSrc(r.data.sources)); setComp(null); api.post("/comparison", {}).then((r) => setComp(r.data)); }, [rev]);
  const refresh = () => { setEdit(null); setRev((r) => r + 1); };
  const remove = async () => { try { await api.delete(`/conventional/${del.id}`); toast.success(`${del.name} removed`); refresh(); } catch (e) { toast.error(errMsg(e)); } setDel(null); };
  const upload = async (e) => {
    const fl = e.target.files?.[0];
    if (!fl) return;
    const fd = new FormData(); fd.append("file", fl);
    try { const r = await api.post("/conventional/import", fd); toast.success(`Imported ${r.data.imported} source(s)`); r.data.errors.forEach((x) => toast.error(x)); refresh(); } catch (er) { toast.error(errMsg(er)); }
    e.target.value = "";
  };
  const max = src?.length ? Math.max(...src.map((s) => s.price_high)) * 1.05 : 1;

  return (
    <div>
      <Link to="/hub" data-testid="prices-back-hub" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Cost & Fix Hub</Link>
      <PageHeader eyebrow="Section 13" title="Reference prices" desc="Conventional protein sources the by-products are compared against. Edit, add or import your own quotes."
        actions={<>
          <button data-testid="source-add-btn" onClick={() => setEdit("new")} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"><Plus className="h-4 w-4" /> Add source</button>
          <button data-testid="source-import-btn" onClick={() => file.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-semibold hover:bg-accent"><Upload className="h-4 w-4" /> Import CSV</button>
          <input ref={file} data-testid="source-import-input" type="file" accept=".csv,text/csv" className="hidden" onChange={upload} />
          <a data-testid="source-template-btn" href={`${API}/conventional/template`} className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-semibold hover:bg-accent"><FileDown className="h-4 w-4" /> CSV template</a>
          <AssumptionsSheet onSaved={refresh} />
          <CurrencySelect />
        </>} />
      {live && <Note tone={live.available ? "info" : "warn"} testid="live-price-status"><span className="inline-flex items-center gap-1.5">{live.available ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}{live.message}</span></Note>}
      <Section testid="sources-table-section" className="my-6" eyebrow="Placeholder INR prices · assumption: verify" title={`${src?.length ?? "…"} conventional sources`} right={<IllustrativeBadge />}>
        {!src ? <CardSkeleton rows={4} /> : (
          <div className="overflow-x-auto">
            <table data-testid="sources-table" className="w-full text-left">
              <thead><tr className="text-xs text-muted-foreground"><th className="py-2">Source</th><th>Price range per kg</th><th>Protein</th><th>Digestibility</th><th>Allergen risk</th><th /></tr></thead>
              <tbody className="divide-y">{src.map((s) => <Row key={s.id} s={s} max={max} onEdit={setEdit} onDelete={setDel} />)}</tbody>
            </table>
          </div>
        )}
      </Section>
      <div className="flex items-end gap-3 pb-2 pt-4"><span className="font-mono text-xs text-muted-foreground">04</span><h2 className="font-display text-2xl font-extrabold tracking-tight">How the by-products compare</h2></div>
      {!comp ? <CardSkeleton rows={5} /> : <ComparisonSection data={comp} />}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent data-testid="source-dialog" className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader><DialogTitle>{edit === "new" ? "Add a conventional source" : `Edit ${edit?.name}`}</DialogTitle></DialogHeader>
          {edit && <SourceForm key={edit === "new" ? "new" : edit.id} source={edit === "new" ? null : edit} onSaved={refresh} />}
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent data-testid="source-delete-dialog">
          <AlertDialogHeader><AlertDialogTitle>Remove {del?.name}?</AlertDialogTitle><AlertDialogDescription>It disappears from every comparison chart. You can add it again later.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel data-testid="source-delete-cancel">Cancel</AlertDialogCancel><AlertDialogAction data-testid="source-delete-confirm" onClick={remove}>Remove</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
