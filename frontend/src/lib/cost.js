import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { CheckCircle2, UserCheck, Ban, Bug, Droplet, TrendingDown, Wheat, Layers, Atom, ShieldOff, Leaf, Frown, Skull, Biohazard, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

const SYM = { INR: "₹", USD: "$", EUR: "€" };
const CurrencyCtx = createContext(null);

export function CurrencyProvider({ children }) {
  const [cur, setCur] = useState(() => localStorage.getItem("currency") || "INR");
  const [fx, setFx] = useState({ INR: 1, USD: 0.012, EUR: 0.011 });
  useEffect(() => { api.get("/cost/assumptions").then((r) => setFx(r.data.assumptions.fx_per_inr)).catch(() => {}); }, []);
  useEffect(() => { localStorage.setItem("currency", cur); }, [cur]);
  const value = useMemo(() => {
    const rate = fx[cur] ?? 1;
    const conv = (v) => (v === null || v === undefined ? null : v * rate);
    const money = (v, d) => {
      if (v === null || v === undefined || Number.isNaN(v)) return "—";
      const x = v * rate;
      const dd = d ?? (Math.abs(x) < 10 ? 2 : Math.abs(x) < 100 ? 1 : 0);
      return `${x < 0 ? "−" : ""}${SYM[cur]}${Math.abs(x).toLocaleString(cur === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: dd })}`;
    };
    return { cur, setCur, rate, sym: SYM[cur], conv, money, setFx, currencies: Object.keys(SYM) };
  }, [cur, fx]);
  return <CurrencyCtx.Provider value={value}>{children}</CurrencyCtx.Provider>;
}

export const useMoney = () => useContext(CurrencyCtx);

export function CurrencySelect() {
  const { cur, setCur, currencies } = useMoney();
  return (
    <label className="inline-flex h-9 items-center gap-1.5 rounded-full border bg-card pl-3 pr-1 text-xs font-semibold"><span className="text-muted-foreground">Currency</span>
      <select data-testid="currency-select" value={cur} onChange={(e) => setCur(e.target.value)} className="h-7 rounded-full bg-transparent px-1 text-xs font-semibold focus:outline-none">
        {currencies.map((c) => <option key={c} value={c}>{SYM[c]} {c}</option>)}
      </select></label>
  );
}

export const FIX_TONE = {
  Fixable: { color: "#15803d", soft: "rgba(21,128,61,.12)", Icon: CheckCircle2, label: "Fixable" },
  "Human review required": { color: "#b45309", soft: "rgba(180,83,9,.12)", Icon: UserCheck, label: "Fix with validation / human review" },
  "Divert or reject": { color: "#b91c1c", soft: "rgba(185,28,28,.12)", Icon: Ban, label: "Divert or reject" },
};

export const PROBLEM_ICON = { bug: Bug, droplet: Droplet, "trending-down": TrendingDown, wheat: Wheat, layers: Layers, atom: Atom,
  "shield-off": ShieldOff, leaf: Leaf, frown: Frown, skull: Skull, biohazard: Biohazard, "alert-triangle": AlertTriangle };

export const METHOD_LABEL = { sieving: "Sieving", milling_sieving: "Milling + sieving", separation: "Selective separation", air_classification: "Air classification",
  fractionation: "Fractionation", defatting: "Defatting", wet_extraction: "Wet extraction", soaking: "Soaking", washing: "Washing", phytase: "Phytase",
  enzymatic: "Enzymes", fermentation: "Fermentation", selective_extraction: "Selective extraction", heat: "Heat treatment", stabilisation: "Stabilisation",
  kill_step: "Kill step + retest", drying: "Drying", antioxidants: "Antioxidants", packaging: "Packaging", storage: "Storage",
  segregate: "Segregate / relabel", cleaning: "Clean & validate", supplier: "Change supplier", divert: "Divert / reject" };

export const SCEN_TONE = { pass: "#15803d", fixes: "#b45309", rejected: "#b91c1c" };
export const GROUP_COLOR = { "Raw material": "#9a5b3c", Processing: "#d97706", Testing: "#0369a1", Overhead: "#78716c", "Disposal / diversion": "#b91c1c", "Purchase price": "#475569" };

export const median = (xs) => { const s = [...xs].filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
export const pct = (x, d = 0) => (x === null || x === undefined ? "—" : `${Number(x).toFixed(d)}%`);
export const kg = (x) => (x === null || x === undefined ? "—" : `${Math.round(x).toLocaleString()} kg`);
export const short = (s, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function downloadCsv(name, data) {
  if (!data) return;
  const esc = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [data.columns.map(esc).join(","), ...data.rows.map((r) => r.map(esc).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  a.click();
}

export function fixScores(f, all) {
  const maxC = Math.max(...all.map((x) => x.cost_typical), 1);
  const maxT = Math.max(...all.map((x) => x.time_h), 1);
  return {
    Cost: 100 * (1 - Math.log1p(f.cost_typical) / Math.log1p(maxC)),
    Speed: 100 * (1 - Math.log1p(f.time_h) / Math.log1p(maxT)),
    "Protein retention": f.protein_recovery * 100,
    Effectiveness: f.effectiveness ?? 0,
    "Ease of scale-up": f.scale_ease,
  };
}

export const bestValue = (fs) => fs.filter((f) => f.status !== "Divert or reject" && f.effectiveness)
  .sort((a, b) => b.effectiveness / Math.max(b.cost_typical, 0.5) - a.effectiveness / Math.max(a.cost_typical, 0.5))[0];

export const METRICS = [
  ["per_kg_product", "per kg product"], ["per_kg_protein", "per kg protein"], ["per_kg_dig", "per kg digestible protein"], ["per_serving", "per 25 g protein serving"],
];

export const relation = (x, y) => (x.high < y.low ? "cheaper" : x.low > y.high ? "more expensive" : "comparable");
