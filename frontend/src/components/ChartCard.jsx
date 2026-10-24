import { useRef, useState } from "react";
import Plotly from "plotly.js-dist-min";
import { toPng } from "html-to-image";
import { Table2, BarChart3, ImageDown, FileDown, Receipt, Sparkles } from "lucide-react";
import { downloadCsv } from "@/lib/cost";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const IllustrativeBadge = () => (
  <span data-testid="illustrative-badge" className="inline-flex items-center gap-1 rounded-full border border-dashed border-stone-400 bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300">
    <Receipt className="h-3 w-3" aria-hidden /> Illustrative, replace with real quotes
  </span>
);

export const ProjectedTag = () => (
  <span data-testid="projected-tag" className="inline-flex items-center gap-1 rounded-full border border-sky-600/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:text-sky-300">
    <Sparkles className="h-3 w-3" aria-hidden /> After fix (projected)
  </span>
);

const IconBtn = ({ label, onClick, children, testid }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" data-testid={testid} aria-label={label} onClick={onClick} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">{children}</button>
    </TooltipTrigger>
    <TooltipContent className="text-xs">{label}</TooltipContent>
  </Tooltip>
);

export const DataTable = ({ data, money }) => (
  <div className="max-h-[420px] overflow-auto rounded-xl border">
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-secondary"><tr>{data.columns.map((c) => <th key={c} className="px-3 py-2 text-left font-semibold">{c}</th>)}</tr></thead>
      <tbody className="divide-y">{data.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="px-3 py-1.5 font-mono">{typeof v === "number" ? (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2)) : v}</td>)}</tr>)}</tbody>
    </table>
  </div>
);

export function ChartCard({ id, eyebrow, title, alt, cost, projected, data, right, children, className = "", focused, hideTable }) {
  const [asTable, setAsTable] = useState(false);
  const body = useRef(null);
  const png = async () => {
    const el = body.current?.querySelector(".js-plotly-plot");
    if (el && !asTable) return Plotly.downloadImage(el, { format: "png", filename: `${id}_DEMO`, scale: 2 });
    const bg = getComputedStyle(document.querySelector("section[id^='chart-']") || document.body).backgroundColor;
    const url = await toPng(body.current, { backgroundColor: bg, pixelRatio: 2 });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}_DEMO.png`;
    a.click();
  };
  return (
    <section id={`chart-${id}`} data-testid={`chart-${id}`} aria-labelledby={`h-${id}`} aria-describedby={`alt-${id}`}
      className={`card-surface fade-up min-w-0 scroll-mt-40 p-5 transition-shadow duration-500 sm:p-6 ${focused ? "ring-4 ring-amber-400/70" : ""} ${className}`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">{eyebrow && <span className="eyebrow">{eyebrow}</span>}{cost && <IllustrativeBadge />}{projected && <ProjectedTag />}</div>
          <h3 id={`h-${id}`} data-testid={`headline-${id}`} className="text-base font-bold leading-snug sm:text-lg">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {right}
          {data && !hideTable && <IconBtn testid={`table-toggle-${id}`} label={asTable ? "View as chart" : "View as table"} onClick={() => setAsTable((x) => !x)}>{asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}</IconBtn>}
          <IconBtn testid={`png-${id}`} label="Download PNG" onClick={png}><ImageDown className="h-4 w-4" /></IconBtn>
          {data && <IconBtn testid={`csv-${id}`} label="Download data (CSV)" onClick={() => downloadCsv(`${id}_DEMO.csv`, data)}><FileDown className="h-4 w-4" /></IconBtn>}
        </div>
      </header>
      <p id={`alt-${id}`} className="sr-only">{alt || title}</p>
      <div ref={body} className="min-w-0">{asTable && data ? <DataTable data={data} /> : children}</div>
    </section>
  );
}
