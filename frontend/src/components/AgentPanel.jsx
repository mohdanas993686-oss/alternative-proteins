import { useEffect, useRef, useState } from "react";
import { Bot, Play, Send, Loader2, CheckCircle2, AlertCircle, UserCheck, ChevronDown, Wrench } from "lucide-react";
import { toast } from "sonner";
import { api, streamSSE, errMsg } from "@/lib/api";
import { AiLabel } from "@/components/common";

export const FormattedText = ({ text }) => (
  <div className="space-y-1 text-sm leading-relaxed">
    {text.split("\n").map((l, i) => {
      const t = l.trim();
      if (!t) return <div key={i} className="h-1.5" />;
      if (t.startsWith("- ")) return <p key={i} className="flex gap-2 pl-1"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" /><span>{t.slice(2)}</span></p>;
      if (t.endsWith(":") && t.length < 60) return <p key={i} className="pt-2 font-display font-bold">{t}</p>;
      return <p key={i}>{t.replace(/\*\*/g, "")}</p>;
    })}
  </div>
);

const Step = ({ s }) => (
  <li data-testid={`agent-step-${s.step}`} className="fade-up relative pl-8">
    <span className={`absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border bg-card ${s.status === "running" ? "border-amber-500" : s.status === "error" ? "border-rose-500" : "border-emerald-600"}`}>
      {s.status === "running" ? <Loader2 className="h-3 w-3 animate-spin text-amber-600" /> : s.status === "error" ? <AlertCircle className="h-3 w-3 text-rose-600" /> : <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
    </span>
    <div className="flex flex-wrap items-center gap-2">
      <code className="rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold">{s.tool}({s.args?.ids ? `[${s.args.ids.length ? s.args.ids.join(", ") : "all"}]` : ""})</code>
      <span className="text-[11px] text-muted-foreground">step {s.step}</span>
    </div>
    <p className="mt-1 text-xs italic text-muted-foreground">{s.reasoning}</p>
    {s.summary && <p className="mt-1 text-xs font-medium">{s.summary}</p>}
    {s.result && (
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer select-none text-primary">View raw result</summary>
        <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-secondary p-2 font-mono text-[10px]">{JSON.stringify(s.result, null, 2)}</pre>
      </details>
    )}
  </li>
);

const Turn = ({ t, sampleId, onReview, reviewed }) => (
  <div className="space-y-3">
    {t.question && <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">{t.question}</div>}
    {t.steps.length > 0 && (
      <div data-testid="agent-timeline" className="rounded-xl border bg-background/60 p-4">
        <p className="eyebrow mb-3 flex items-center gap-1.5"><Wrench className="h-3 w-3" /> Agent activity</p>
        <ol className="space-y-4 border-l border-dashed border-border pl-0 [&>li]:ml-[-10px]">{t.steps.map((s) => <Step key={s.step} s={s} />)}</ol>
      </div>
    )}
    {t.notice && <p className="text-xs text-amber-700 dark:text-amber-300">{t.notice}</p>}
    {(t.text || t.busy) && (
      <div data-testid="agent-answer" className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><AiLabel />{t.provider && <span className="font-mono text-[10px] text-muted-foreground">{t.provider}</span>}</div>
        {t.text ? <FormattedText text={t.text} /> : <p className="pulse-dot text-sm text-muted-foreground">Drafting…</p>}
      </div>
    )}
    {t.review && sampleId && (
      <button data-testid="human-review-btn" onClick={onReview} disabled={reviewed} className="inline-flex items-center gap-2 rounded-full border border-rose-600/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-800 transition-colors hover:bg-rose-500/20 disabled:opacity-60 dark:text-rose-300">
        <UserCheck className="h-4 w-4" /> {reviewed ? "Review requested" : "Human review required"}
      </button>
    )}
  </div>
);

const SUGGEST = ["Which by-product is best for protein flour?", "Why was this sample flagged?", "What lab data is still missing?"];

export default function AgentPanel({ sampleId, onReviewed, compact }) {
  const [status, setStatus] = useState({ providers: [] });
  const [provider, setProvider] = useState(() => localStorage.getItem("agent-provider") || "claude");
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [session] = useState(() => `s-${Date.now().toString(36)}`);
  const [reviewed, setReviewed] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => { api.get("/agent/status").then((r) => setStatus(r.data)).catch(() => {}); }, []);
  useEffect(() => { localStorage.setItem("agent-provider", provider); }, [provider]);
  useEffect(() => { if (sampleId) api.get(`/report/${sampleId}`).then((r) => setReviewed(r.data.sample.review_status === "pending_human_review")).catch(() => {}); }, [sampleId]);
  useEffect(() => { const b = boxRef.current; if (b) b.scrollTop = b.scrollHeight; }, [turns]);

  const patch = (fn) => setTurns((ts) => { const c = [...ts]; c[c.length - 1] = fn({ ...c[c.length - 1] }); return c; });

  const handle = (e) => {
    if (e.type === "step") patch((t) => ({ ...t, steps: [...t.steps, e] }));
    if (e.type === "step_result") patch((t) => ({ ...t, steps: t.steps.map((s) => (s.step === e.step ? { ...s, ...e } : s)) }));
    if (e.type === "text") patch((t) => ({ ...t, text: e.text }));
    if (e.type === "notice") patch((t) => ({ ...t, notice: e.message, text: "" }));
    if (e.type === "final") patch((t) => ({ ...t, text: e.text, provider: e.provider, busy: false }));
    if (e.type === "done") patch((t) => ({ ...t, review: e.human_review_required }));
  };

  const run = async (path, body, question) => {
    setBusy(true);
    setTurns((ts) => [...ts, { question, steps: [], text: "", busy: true }]);
    try { await streamSSE(path, body, handle); } catch (e) { toast.error(errMsg(e)); patch((t) => ({ ...t, busy: false, text: `Error: ${e.message}` })); }
    setBusy(false);
  };

  const ask = (q) => { const m = (q ?? msg).trim(); if (!m || busy) return; setMsg(""); run("/agent/chat", { message: m, session_id: session, sample_id: sampleId || null, provider }, m); };
  const review = async () => {
    if (reviewed) return;
    try { await api.post(`/samples/${sampleId}/review`, { note: "Escalated from Analysis Agent panel" }); setReviewed(true); toast.success("Escalated to a human reviewer"); onReviewed?.(); } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="agent-panel" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Bot className="h-4 w-4" /></span><div><p className="font-display font-bold leading-tight">Analysis Agent</p><p className="text-[11px] text-muted-foreground">{status.llm_available ? "LLM with tool calling" : "Rule-based assistant (no API key)"}</p></div></div>
        <label className="relative text-xs">
          <span className="sr-only">AI model</span>
          <select data-testid="agent-provider-select" value={provider} onChange={(e) => setProvider(e.target.value)} className="field h-8 appearance-none pr-7 text-xs">
            {status.providers.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-2 h-4 w-4 text-muted-foreground" />
        </label>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Read-only: the agent cannot change lab results and never declares a sample safe. Every action is logged.</p>
      {sampleId && (
        <button data-testid="run-full-analysis-btn" disabled={busy} onClick={() => run("/agent/run", { sample_id: sampleId, provider })}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run full analysis
        </button>
      )}
      <div ref={boxRef} className={`space-y-6 overflow-y-auto pr-1 ${compact ? "max-h-[60vh]" : "max-h-[65vh]"}`}>
        {turns.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">Ask a question or run a full analysis. The agent will plan steps, call the app's tools and explain what it did.</p>}
        {turns.map((t, i) => <Turn key={i} t={t} sampleId={sampleId} onReview={review} reviewed={reviewed} />)}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SUGGEST.filter((s) => sampleId || !s.includes("this sample") && !s.includes("missing")).map((s) => (
          <button key={s} data-testid="agent-suggestion" disabled={busy} onClick={() => ask(s)} className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">{s}</button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex gap-2">
        <input data-testid="agent-chat-input" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Ask the agent…" aria-label="Ask the agent" className="field rounded-full" maxLength={1000} />
        <button data-testid="agent-chat-send" disabled={busy || !msg.trim()} aria-label="Send" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4" /></button>
      </form>
    </div>
  );
}
