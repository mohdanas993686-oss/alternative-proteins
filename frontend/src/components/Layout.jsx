import { useState } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { useTheme } from "next-themes";
import { LayoutDashboard, FlaskConical, ListChecks, BarChart3, BrainCircuit, Bot, SlidersHorizontal, Map, Moon, Sun, Menu, X, Plus, Sprout, Blend, Coins } from "lucide-react";
import { SafetyBanner, DemoBadge } from "@/components/common";

const NAV = [
  ["/", "Dashboard", LayoutDashboard],
  ["/new", "New analysis", FlaskConical],
  ["/samples", "Samples", ListChecks],
  ["/compare", "Compare", BarChart3],
  ["/blender", "Blender", Blend],
  ["/hub", "Cost & Fix Hub", Coins],
  ["/models", "Model performance", BrainCircuit],
  ["/agent", "Analysis Agent", Bot],
  ["/rules", "Safety rules", SlidersHorizontal],
  ["/roadmap", "Roadmap", Map],
];

const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <button data-testid="theme-toggle" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setTheme(dark ? "light" : "dark")}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border bg-card transition-colors hover:bg-accent">
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
};

const Nav = ({ onNavigate }) => (
  <nav className="flex flex-col gap-1" aria-label="Main">
    {NAV.map(([to, label, Icon]) => (
      <NavLink key={to} to={to} end={to === "/"} onClick={onNavigate} data-testid={`nav-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
        className={({ isActive }) => `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
        <Icon className="h-4 w-4" /> {label}
      </NavLink>
    ))}
  </nav>
);

const Brand = () => (
  <Link to="/" className="flex items-center gap-2.5" data-testid="brand-link">
    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Sprout className="h-5 w-5" /></span>
    <span className="leading-tight"><span className="block font-display text-lg font-extrabold">ByProduct</span><span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Analyser</span></span>
  </Link>
);

export default function Layout() {
  const [open, setOpen] = useState(false);
  return (
    <div className="grain min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-card/70 p-5 backdrop-blur-xl lg:flex">
        <Brand />
        <div className="mt-8 flex-1"><Nav /></div>
        <div className="rounded-xl border bg-secondary/60 p-3 text-xs text-muted-foreground">
          <DemoBadge /> <p className="mt-2">Synthetic data & models for demonstration. Not for real food-safety decisions.</p>
        </div>
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between"><Brand /><button data-testid="mobile-nav-close" aria-label="Close menu" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button></div>
            <Nav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-xl">
          <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-8">
            <div className="flex items-center gap-3">
              <button data-testid="mobile-nav-open" aria-label="Open menu" className="lg:hidden" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
              <span className="hidden font-mono text-xs text-muted-foreground sm:inline">Protein by-product screening workbench</span>
              <DemoBadge />
            </div>
            <div className="flex items-center gap-2">
              <Link to="/new" data-testid="header-new-analysis-btn" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5">
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New analysis</span>
              </Link>
              <ThemeToggle />
            </div>
          </div>
          <SafetyBanner />
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-8 md:px-8 md:py-10"><Outlet /></main>
      </div>
    </div>
  );
}
