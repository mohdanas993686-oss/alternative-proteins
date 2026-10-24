import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { api, BP, fmt } from "@/lib/api";
import { PageHeader, Section, CardSkeleton, Note, Term } from "@/components/common";
import { Plot } from "@/components/Charts";

const clamp = (x) => Math.max(0, Math.min(100, x));
const AXES = ["Protein", "Low fibre", "Low oil", "Low phytate", "Low TIA", "Screening OK"];
const radarVals = (r) => [clamp((r.avg_protein / 55) * 100), clamp(100 - (r.avg_fibre - 5) * 2.5), clamp(100 - (r.avg_oil - 1) * 5),
  clamp(100 - (r.avg_phytate / 70) * 100), clamp(100 - (r.avg_tia / 25) * 100), clamp(100 - (r.flagged / r.n_samples) * 100)];

export default function Compare() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get("/compare").then((r) => setRows(r.data.ranking)); }, []);
  return (
    <div>
      <PageHeader eyebrow="Ranking" title="Compare by-products" desc="Averages over all samples of each type. Use the ranking to prioritise further lab work, not to choose an ingredient." />
      {!rows ? <CardSkeleton rows={6} /> : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-5">
            {rows.map((r, i) => (
              <div key={r.byproduct} data-testid={`rank-card-${r.byproduct}`} className="card-surface card-hover fade-up p-5" style={{ animationDelay: `${i * 70}ms`, borderTop: `4px solid ${BP[r.byproduct].color}` }}>
                <div className="flex items-center justify-between"><span className="font-mono text-xs text-muted-foreground">#{i + 1}</span>{i === 0 && <Trophy className="h-4 w-4 text-amber-600" />}</div>
                <p className="mt-2 font-display text-lg font-bold leading-tight">{r.label}</p>
                <p className="mt-3 font-display text-4xl font-extrabold">{fmt(r.avg_score)}</p>
                <p className="text-xs text-muted-foreground">avg score · base {fmt(r.avg_base_score)} before safety factor</p>
                <p className="mt-2 text-xs">{r.n_samples} samples · {r.flagged} flagged{r.inherent_allergens.length ? ` · allergen: ${r.inherent_allergens.join(", ")}` : ""}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section testid="radar-chart-section" eyebrow="Profile" title="Radar comparison (higher = better)">
              <Plot testid="radar-chart" height={460} data={rows.map((r) => ({ type: "scatterpolar", r: [...radarVals(r), radarVals(r)[0]], theta: [...AXES, AXES[0]], name: r.label, fill: "toself", opacity: 0.55, line: { color: BP[r.byproduct].color } }))}
                layout={{ polar: { domain: { x: [0, 1], y: [0.12, 1] }, radialaxis: { range: [0, 100], tickfont: { size: 9 } } }, margin: { l: 30, r: 30, t: 20, b: 10 }, legend: { orientation: "h", y: 0 } }} />
            </Section>
            <Section testid="composition-compare-section" eyebrow="Composition" title="Average composition (% DM)">
              <Plot testid="composition-compare-chart" height={400} data={[["avg_protein", "Protein", "#15803d"], ["avg_fibre", "Fibre", "#a16207"], ["avg_oil", "Oil", "#d97706"], ["avg_moisture", "Moisture", "#0369a1"]].map(([k, n, c]) => ({ type: "bar", name: n, x: rows.map((r) => r.label), y: rows.map((r) => r[k]), marker: { color: c } }))}
                layout={{ barmode: "group", yaxis: { title: { text: "%" } } }} />
            </Section>
          </div>
          <Section testid="ranking-table-section" eyebrow="Table" title="Side-by-side">
            <div className="overflow-x-auto">
              <table data-testid="ranking-table" className="w-full min-w-[760px] text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Rank</th><th>By-product</th><th>Score</th><th>Protein</th><th>Usable protein g/kg</th><th>Fibre</th><th>Oil</th><th>Phytate mg/g</th><th><Term k="TIU">TIA</Term></th><th>Flagged</th></tr></thead>
                <tbody className="divide-y">{rows.map((r, i) => (
                  <tr key={r.byproduct}><td className="py-2.5 font-mono">{i + 1}</td><td className="font-semibold">{r.label}</td><td className="font-mono">{fmt(r.avg_score)}</td><td className="font-mono">{fmt(r.avg_protein)}</td><td className="font-mono">{fmt(r.avg_usable_protein, 0)}</td><td className="font-mono">{fmt(r.avg_fibre)}</td><td className="font-mono">{fmt(r.avg_oil)}</td><td className="font-mono">{fmt(r.avg_phytate)}</td><td className="font-mono">{fmt(r.avg_tia)}</td><td className="font-mono">{r.flagged}/{r.n_samples}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="mt-4"><Note tone="warn">ANF averages mix lab values and unreliable NIR predictions. Scores are lowered by failed or unconfirmed safety checks on the demo samples.</Note></div>
          </Section>
        </div>
      )}
    </div>
  );
}
