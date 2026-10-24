import { CheckCircle2, Eye, RotateCcw, XCircle, ShieldAlert, Sparkles, FlaskConical, Info, Inbox } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS = {
  PASS: { cls: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-600/30", Icon: CheckCircle2, text: "Pass" },
  REVIEW: { cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-600/30", Icon: Eye, text: "Review" },
  RETEST: { cls: "bg-orange-500/15 text-orange-800 dark:text-orange-300 border-orange-600/30", Icon: RotateCcw, text: "Retest" },
  FAIL: { cls: "bg-rose-500/15 text-rose-800 dark:text-rose-300 border-rose-600/30", Icon: XCircle, text: "Fail" },
};

export const StatusBadge = ({ status, testid }) => {
  const s = STATUS[status] || STATUS.REVIEW;
  return (
    <span data-testid={testid || `status-badge-${status}`} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
      <s.Icon className="h-3.5 w-3.5" aria-hidden /> {s.text.toUpperCase()}
    </span>
  );
};

export const DemoBadge = ({ className = "" }) => (
  <span data-testid="demo-data-badge" className={`inline-flex items-center rounded border border-stone-300 bg-stone-200/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-stone-700 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 ${className}`}>
    Demo data
  </span>
);

export const SourceBadge = ({ source }) =>
  !source ? <span className="text-xs text-muted-foreground">Not available</span> : source === "Lab measured" ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-sky-600/30 bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:text-sky-300"><FlaskConical className="h-3 w-3" />Lab measured</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-violet-600/25 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:text-violet-300"><Sparkles className="h-3 w-3" />AI prediction</span>
  );

export const AiLabel = () => (
  <span data-testid="ai-generated-label" className="inline-flex items-center gap-1 rounded-full border border-amber-600/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
    <Sparkles className="h-3 w-3" /> AI-generated, verify before use
  </span>
);

export const SafetyBanner = () => (
  <div data-testid="safety-banner" role="note" className="flex items-start gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-900 dark:text-amber-200 sm:text-sm md:px-8">
    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
    <span>This tool does not certify food safety. Confirmed results from an accredited laboratory are required. All values shown are <b>DEMO DATA</b>.</span>
  </div>
);

const GLOSSARY = {
  NIR: "Near-infrared spectroscopy: light at 900-1700 nm is shone on the sample; the absorbance pattern relates to protein, oil, water and fibre.",
  PLSR: "Partial Least Squares Regression: the standard chemometrics model that links a whole spectrum to one measured value.",
  Kjeldahl: "Reference lab method for crude protein: total nitrogen is measured and multiplied by a factor (usually 6.25).",
  ANF: "Anti-nutritional factor: natural compounds (phytate, tannins, trypsin inhibitors, lectins, saponins) that reduce nutrient uptake.",
  "Water activity": "Water activity (aw, 0-1) measures 'free' water available to microbes. Above ~0.65 mould growth risk rises.",
  RMSE: "Root-mean-square error of the model on an independent test set; used as the ± error estimate.",
  "R²": "Coefficient of determination: 1.0 means perfect prediction, 0 means no better than the average.",
  SNV: "Standard Normal Variate: corrects scatter differences between scans (particle size, packing).",
  "Savitzky-Golay": "A smoothing derivative filter that removes baseline shifts and sharpens spectral bands.",
  Aflatoxin: "Toxic, carcinogenic compounds produced by Aspergillus moulds, common in groundnut and stored meals.",
  TIU: "Trypsin inhibitor units: how strongly the sample blocks the digestive enzyme trypsin.",
  cfu: "Colony-forming units per gram: count of viable microbes.",
  HPLC: "High-performance liquid chromatography: confirmatory lab method; ELISA and rapid strips are screening tests.",
  Bias: "Average of (predicted − measured). Positive means the model over-predicts.",
};

export const Term = ({ k, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" data-testid={`term-${k.replace(/\W/g, "").toLowerCase()}`} className="cursor-help underline decoration-dotted decoration-primary/60 underline-offset-4">
        {children || k}
      </button>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs text-xs leading-relaxed">{GLOSSARY[k]}</TooltipContent>
  </Tooltip>
);

export const Empty = ({ title, hint, action, testid = "empty-state" }) => (
  <div data-testid={testid} className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center">
    <Inbox className="h-6 w-6 text-muted-foreground" />
    <p className="font-display font-semibold">{title}</p>
    {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
    {action}
  </div>
);

export const Note = ({ children, tone = "info", testid }) => (
  <div data-testid={testid} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${tone === "warn" ? "border-amber-600/30 bg-amber-500/10 text-amber-900 dark:text-amber-200" : "border-primary/20 bg-accent text-accent-foreground"}`}>
    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{children}</span>
  </div>
);

export const PageHeader = ({ eyebrow, title, desc, actions }) => (
  <div className="fade-up mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
    <div>
      <div className="mb-2 flex items-center gap-2"><span className="eyebrow">{eyebrow}</span><DemoBadge /></div>
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl">{title}</h1>
      {desc && <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">{desc}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>
);

export const CardSkeleton = ({ rows = 3 }) => (
  <div data-testid="loading-skeleton" className="card-surface space-y-3 p-6">
    <Skeleton className="h-5 w-1/3" />
    {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
  </div>
);

export const Section = ({ title, eyebrow, right, children, testid, className = "" }) => (
  <section data-testid={testid} className={`card-surface fade-up p-5 sm:p-6 ${className}`}>
    {(title || right) && (
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>{eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}<h2 className="text-lg font-bold sm:text-xl">{title}</h2></div>
        {right}
      </div>
    )}
    {children}
  </section>
);
