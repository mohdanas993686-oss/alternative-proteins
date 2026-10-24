import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { api, BP } from "@/lib/api";
import { PageHeader, Section, CardSkeleton, Empty } from "@/components/common";
import { SampleRow } from "@/pages/Dashboard";
import { Link } from "react-router-dom";

export default function Samples() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [bp, setBp] = useState("");
  const [st, setSt] = useState("");
  useEffect(() => { api.get("/samples").then((r) => setRows(r.data)); }, []);
  const list = useMemo(() => (rows || []).filter((s) =>
    (!q || `${s.sample_code} ${s.supplier} ${s.batch}`.toLowerCase().includes(q.toLowerCase())) && (!bp || s.byproduct === bp) && (!st || s.overall_status === st)), [rows, q, bp, st]);
  return (
    <div>
      <PageHeader eyebrow="Registry" title="Samples" desc="Every sample, its suitability score and the worst screening flag. Open one for the full report." />
      <Section testid="samples-list">
        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_200px_160px]">
          <label className="relative"><span className="sr-only">Search</span><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input data-testid="samples-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, supplier, batch…" className="field pl-9" /></label>
          <select data-testid="samples-filter-byproduct" aria-label="Filter by by-product" value={bp} onChange={(e) => setBp(e.target.value)} className="field"><option value="">All by-products</option>{Object.entries(BP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          <select data-testid="samples-filter-status" aria-label="Filter by status" value={st} onChange={(e) => setSt(e.target.value)} className="field"><option value="">All statuses</option>{["PASS", "REVIEW", "RETEST", "FAIL"].map((s) => <option key={s}>{s}</option>)}</select>
        </div>
        {!rows ? <CardSkeleton rows={6} /> : list.length === 0 ? <Empty title="No matching samples" hint="Try clearing filters, or start a new analysis." action={<Link to="/new" className="text-sm font-semibold text-primary">New analysis →</Link>} /> :
          <div className="-mx-3 divide-y">{list.map((s) => <SampleRow key={s.id} s={s} />)}</div>}
      </Section>
    </div>
  );
}
