import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FlaskConical, AlertTriangle, Wheat, UserCheck, Plus } from "lucide-react";
import { api, fmt } from "@/lib/api";
import { PageHeader, CardSkeleton, Section, Empty, StatusBadge, DemoBadge, Term } from "@/components/common";
import { Plot } from "@/components/Charts";

const HERO = "https://images.pexels.com/photos/30580656/pexels-photo-30580656.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

const Stat = ({ label, value, unit, Icon, tone, testid, i }) => (
  <div data-testid={testid} className="card-surface card-hover fade-up p-5" style={{ animationDelay: `${i * 70}ms` }}>
    <div className="flex items-center justify-between"><p className="eyebrow">{label}</p><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4 w-4" /></span></div>
    <p className="mt-4 font-display text-4xl font-extrabold">{value}<span className="ml-1 text-base font-semibold text-muted-foreground">{unit}</span></p>
  </div>
);

export const SampleRow = ({ s }) => (
  <Link to={`/samples/${s.id}`} data-testid={`sample-row-${s.sample_code}`} className="grid grid-cols-2 items-center gap-2 rounded-xl px-3 py-3 transition-colors hover:bg-accent sm:grid-cols-[1fr_1.3fr_0.8fr_0.8fr_auto]">
    <div><p className="font-mono text-sm font-semibold">{s.sample_code}</p><p className="text-xs text-muted-foreground">{s.sample_date}</p></div>
    <p className="text-sm">{s.byproduct_label}<span className="block text-xs text-muted-foreground">{s.supplier}</span></p>
    <p className="text-sm"><span className="font-semibold">{fmt(s.protein)}</span><span className="text-xs text-muted-foreground"> % DM protein</span></p>
    <p className="text-sm"><span className="font-semibold">{fmt(s.score)}</span><span className="text-xs text-muted-foreground"> /100</span></p>
    <div className="flex items-center gap-2 justify-self-start sm:justify-self-end"><StatusBadge status={s.overall_status} testid={`sample-status-${s.sample_code}`} />{s.review_status === "pending_human_review" && <UserCheck className="h-4 w-4 text-rose-600" aria-label="Human review pending" />}</div>
  </Link>
);

export default function Dashboard() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/dashboard").then((r) => setD(r.data)); }, []);
  const dist = d?.status_distribution || {};
  return (
    <div>
      <div className="fade-up relative mb-8 overflow-hidden rounded-3xl border bg-primary text-primary-foreground">
        <img src={HERO} alt="Grain and seed samples in a lab" className="absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-luminosity" />
        <div className="relative grid gap-6 p-7 sm:p-10 md:grid-cols-[1.4fr_1fr] md:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2"><span className="font-mono text-[11px] uppercase tracking-[0.2em] opacity-80">By-product protein screening</span><DemoBadge /></div>
            <h1 className="text-4xl font-extrabold leading-[1.05] sm:text-5xl lg:text-6xl">Turn oil-mill & dal-mill residues into evidence.</h1>
            <p className="mt-4 max-w-xl text-sm opacity-90 sm:text-base">AI-predicted composition from <Term k="NIR">NIR</Term> spectra, rule-based safety flags and an auditable analysis agent for guar meal, groundnut cake, almond cake, rice bran and pulse residues.</p>
          </div>
          <div className="flex flex-col gap-3 md:items-end">
            <Link to="/new" data-testid="dashboard-new-analysis-cta" className="inline-flex items-center gap-2 rounded-full bg-background px-6 py-3 text-sm font-bold text-foreground transition-transform hover:-translate-y-0.5">
              <Plus className="h-4 w-4" /> New analysis <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/compare" data-testid="dashboard-compare-link" className="text-sm underline-offset-4 opacity-90 hover:underline">Compare the 5 by-products →</Link>
          </div>
        </div>
      </div>

      {!d ? <div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <CardSkeleton key={i} rows={1} />)}</div> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat i={0} testid="stat-samples-analysed" label="Samples analysed" value={d.samples_analysed} Icon={FlaskConical} tone="bg-primary/10 text-primary" />
          <Stat i={1} testid="stat-flagged" label="Flagged (fail / retest)" value={d.flagged} Icon={AlertTriangle} tone="bg-orange-500/15 text-orange-700 dark:text-orange-300" />
          <Stat i={2} testid="stat-avg-protein" label="Average protein" value={fmt(d.avg_protein)} unit="% DM" Icon={Wheat} tone="bg-amber-500/15 text-amber-700 dark:text-amber-300" />
          <Stat i={3} testid="stat-review-pending" label="Awaiting human review" value={d.review_pending} Icon={UserCheck} tone="bg-rose-500/15 text-rose-700 dark:text-rose-300" />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Section testid="recent-samples" eyebrow="Latest" title="Recent samples" right={<Link to="/samples" data-testid="view-all-samples" className="text-sm font-semibold text-primary hover:underline">View all →</Link>}>
          {!d ? <CardSkeleton /> : d.recent.length === 0 ? <Empty title="No samples yet" hint="Start a new analysis to scan your first by-product." action={<Link to="/new" className="text-sm font-semibold text-primary">New analysis →</Link>} /> :
            <div className="-mx-3 divide-y">{d.recent.map((s) => <SampleRow key={s.id} s={s} />)}</div>}
        </Section>
        <Section testid="status-distribution" eyebrow="Rule engine" title="Screening status">
          {d && <Plot height={260} data={[{ type: "pie", hole: 0.62, labels: ["Pass", "Review", "Retest", "Fail"], values: [dist.PASS, dist.REVIEW, dist.RETEST, dist.FAIL], marker: { colors: ["#15803d", "#d97706", "#c2410c", "#dc2626"] }, textinfo: "value", hovertemplate: "%{label}: %{value}<extra></extra>" }]} layout={{ margin: { l: 10, r: 10, t: 10, b: 10 }, legend: { orientation: "h", y: -0.1 } }} />}
          <p className="mt-2 text-xs text-muted-foreground">Status is the worst flag across aflatoxin, microbial and allergen checks. PASS only means no flag from the tests entered.</p>
        </Section>
      </div>
    </div>
  );
}
