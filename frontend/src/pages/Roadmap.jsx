import { CheckCircle2, CircleDot, Circle } from "lucide-react";
import { PageHeader } from "@/components/common";

const STAGES = [
  { n: "Stage 1", title: "Composition analyser", state: "Prototype (this app)", Icon: CheckCircle2, items: ["NIR prediction of protein, oil, moisture, fibre (total / soluble / insoluble) and residual gum", "PLSR baseline vs SVR / Random Forest, per target & by-product", "Batch-wise validation, error estimates, model performance page"] },
  { n: "Stage 2", title: "Safety screening", state: "Prototype rule engine", Icon: CircleDot, items: ["Aflatoxin (AFB1 / total) with method-aware rules: ELISA, rapid test, HPLC", "Microbial quality & pathogen results with confirmation status", "Allergens: peanut, almond, pulse; cross-contact & supplier verification", "Thresholds aligned to current FSSAI requirements (to be verified)"] },
  { n: "Stage 3", title: "Real sensor & lab data integration", state: "Planned", Icon: Circle, items: ["Connect handheld / benchtop NIR instruments", "Import results from accredited labs (LIMS / CSV)", "Recalibrate models on real reference data; independent validation", "Human-review workflow with sign-off and audit trail"] },
];

export default function Roadmap() {
  return (
    <div>
      <PageHeader eyebrow="Plan" title="Roadmap" desc="From a synthetic-data prototype to a lab-validated screening tool." />
      <ol className="relative space-y-6 border-l-2 border-dashed border-primary/30 pl-8">
        {STAGES.map((s, i) => (
          <li key={s.n} data-testid={`roadmap-stage-${i + 1}`} className="card-surface card-hover fade-up relative p-6" style={{ animationDelay: `${i * 100}ms` }}>
            <span className="absolute -left-[45px] top-6 flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary bg-background text-primary"><s.Icon className="h-4 w-4" /></span>
            <p className="eyebrow">{s.n} · {s.state}</p>
            <h2 className="mt-1 text-2xl font-extrabold">{s.title}</h2>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">{s.items.map((x) => <li key={x} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{x}</li>)}</ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
