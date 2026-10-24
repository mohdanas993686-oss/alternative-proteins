import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader, Section, Note } from "@/components/common";
import AgentPanel from "@/components/AgentPanel";

export default function AgentPage() {
  const [samples, setSamples] = useState([]);
  const [sid, setSid] = useState("");
  const [logs, setLogs] = useState([]);
  const loadLogs = () => api.get("/agent/logs", { params: { limit: 40 } }).then((r) => setLogs(r.data));
  useEffect(() => { api.get("/samples").then((r) => setSamples(r.data)); loadLogs(); }, []);
  return (
    <div>
      <PageHeader eyebrow="Agentic AI" title="Analysis Agent" desc="Ask questions across all samples, or pick a sample to run a full analysis. The agent plans, calls the app's own tools, and explains each step." />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Section testid="agent-chat-section">
          <label className="mb-4 block text-sm"><span className="mb-1 block font-semibold">Sample context (optional)</span>
            <select data-testid="agent-sample-select" value={sid} onChange={(e) => setSid(e.target.value)} className="field">
              <option value="">No sample: questions across all by-products</option>
              {samples.map((s) => <option key={s.id} value={s.id}>{s.sample_code} · {s.byproduct_label} · {s.overall_status}</option>)}
            </select>
          </label>
          <AgentPanel key={sid} sampleId={sid || null} />
        </Section>
        <div className="space-y-6">
          <Section testid="agent-guardrails" eyebrow="Guardrails" title="What the agent can and can't do">
            <ul className="space-y-2 text-sm">
              {["Tools: get_sample, run_prediction, check_safety_rules, compare_byproducts, find_missing_data, generate_report, suggest_retests.",
                "Read-only plus drafting: it cannot modify or delete lab results.",
                "Never declares a sample safe, pathogen-free or cleared for food use; only 'not detected by this test'.",
                "Positive, uncertain or failing results are escalated with a 'Human review required' button.",
                "Without an API key it falls back to a rule-based assistant."].map((t) => <li key={t} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{t}</li>)}
            </ul>
          </Section>
          <Section testid="agent-log-section" eyebrow="Traceability" title="Agent action log" right={<button data-testid="refresh-logs-btn" onClick={loadLogs} className="text-xs font-semibold text-primary hover:underline">Refresh</button>}>
            <Note>Every tool call and draft is saved to the database.</Note>
            <ul className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
              {logs.length === 0 && <p className="text-sm text-muted-foreground">No agent activity yet.</p>}
              {logs.map((l) => (
                <li key={l.id} data-testid="agent-log-item" className="rounded-lg border p-2 text-xs">
                  <div className="flex justify-between gap-2"><code className="font-semibold">{l.kind === "tool_call" ? l.tool : l.kind}</code><span className="text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span></div>
                  {l.reasoning && <p className="mt-1 text-muted-foreground">{l.reasoning}</p>}
                  <p className="font-mono text-[10px] text-muted-foreground">run {l.run_id}{l.sample_id ? ` · sample ${l.sample_id}` : ""}</p>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
