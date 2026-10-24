# ByProduct Analyser — PRD

## Original problem statement
Working prototype web app "ByProduct Analyser": AI platform analysing protein-rich agricultural by-products (guar meal, groundnut cake, almond cake, rice bran, pulse residues) for suitability as human-food protein ingredients. All data synthetic, labelled DEMO DATA, never implying safety. Modules: NIR composition analyser, ANFs as separate targets, rule-based food-safety screening (PASS/REVIEW/RETEST/FAIL), final report + PDF + suitability score, ML training (SNV+SG, batch split, PLSR vs SVR vs RF per target & by-product, metrics page, retrain, CSV upload), FastAPI + SQLite REST API, simulated NIR scan / CSV upload, LLM summaries, Analysis Agent with tool calls, live activity timeline, guardrails, human review escalation, full logging, rule-based fallback. Dashboard, 4-step wizard, comparison view, roadmap, tooltips, dark/light, responsive, accessible, agri-tech palette.

## User choices
- Agent AI: Claude Sonnet via Emergent key; later also ChatGPT, so both are available with a provider switch (claude-sonnet-5-5 / gpt-5.6-terra)
- Storage: SQLite file (as specified; SQLITE_PATH env)

## Architecture
- Backend: FastAPI (server.py), db.py (sqlite3), rules.py (rule engine/score/report), agent.py (7 read-only tools, SSE, guardrail sanitizer, fallback), report_pdf.py (reportlab), seed.py (20 demo samples), ml/ (synth, generate_data, preprocess, train, predictor). Docs at /api/docs.
- Frontend: React + Tailwind + react-plotly.js, next-themes; pages Dashboard, NewAnalysis, Samples, SampleReport, Compare, ModelPerformance, AgentPage, Rules, Roadmap.

## Implemented (2026-06)
- Everything in the spec above, working end to end; tested with the testing agent (iteration_1: backend 21/22, frontend 100%)
- Fixes after test: /api/docs path, the "usable protein (safety-adjusted)" rename, a wider guardrail sanitizer that also cleans streamed text, trainable CSV template and a 422 error for too little data, the agent's review button showing its pending state, panel-only autoscroll, sorted preview table, a bigger radar chart

## Backlog
- P1: Human reviewer workflow (sign-off, reviewer notes, clear review status)
- P1: Sample edit/delete (with an audit trail), lab-result history view
- P2: Shadcn calendar date picker; caching for list/compare endpoints at scale
- P2: Real NIR instrument / LIMS import (Stage 3)
