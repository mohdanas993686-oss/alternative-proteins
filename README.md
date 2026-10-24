# ByProduct Analyser (prototype, DEMO DATA)

AI-assisted screening of protein-rich agricultural by-products (guar meal, groundnut cake, almond cake, rice bran, pulse-processing residues) for further evaluation as human-food protein ingredients.

> **All data is synthetic.** This tool does not certify food safety. Confirmed results from an accredited laboratory are required.

## Architecture
```
frontend/ (React + Tailwind + Plotly)
  pages: Dashboard, New analysis wizard, Samples, Sample report, Compare,
         Model performance, Analysis Agent, Safety rules, Roadmap
backend/ (FastAPI + scikit-learn + SQLite)
  server.py        REST API (/api/*, docs at /docs)
  db.py            SQLite schema: samples, predictions, lab_results (one row per target),
                   agent_logs, chat_messages, settings
  rules.py         target catalogue, rule engine (PASS/REVIEW/RETEST/FAIL), suitability score, report builder
  agent.py         Analysis Agent: read-only tools + LLM planning (Claude or ChatGPT) + guardrails + rule-based fallback
  report_pdf.py    PDF export (reportlab)
  seed.py          20 seeded demo samples with varied lab scenarios
  ml/synth.py          synthetic spectra model (900-1700 nm, 256 points, 3 scans averaged)
  ml/generate_data.py  writes ml/data/synthetic_dataset.csv (250 samples, 40-60 per by-product)
  ml/preprocess.py     SNV + Savitzky-Golay (1st derivative)
  ml/train.py          batch-wise split (20% test), PLSR vs SVR vs Random Forest per target & per by-product,
                       RMSE / MAE / R2 / bias, best models saved with joblib to ml/models/
  ml/predictor.py      loads models, predicts with error estimate (test RMSE)
```

## Setup
```bash
cd backend
pip install -r requirements.txt
# .env: SQLITE_PATH=/path/to/byproduct.db   EMERGENT_LLM_KEY=... (optional)
python -m ml.generate_data      # synthetic dataset
python -m ml.train              # train + save models (~35 s)
uvicorn server:app --host 0.0.0.0 --port 8001   # seeds demo samples on first start

cd ../frontend
yarn install
# .env: REACT_APP_BACKEND_URL=http://localhost:8001
yarn start
```
Without `EMERGENT_LLM_KEY` the agent falls back to a rule-based assistant.

## Key endpoints
`POST /api/samples`, `GET /api/samples`, `POST /api/predict`, `POST /api/lab-results`, `GET /api/report/{id}`,
`GET /api/report/{id}/pdf`, `POST /api/train`, `GET /api/train/status`, `POST /api/train/upload`, `GET /api/model/metrics`,
`POST /api/simulate-scan`, `POST /api/spectrum/parse`, `GET|PUT /api/thresholds`, `POST /api/agent/run` (SSE),
`POST /api/agent/chat` (SSE), `GET /api/agent/logs`.

## Limitations
- Spectra, reference values and lab results are simulated; metrics are not scientifically valid for real samples.
- ANF models (phytate, tannins, trypsin inhibitors) are deliberately weak, as in reality; lab assays are recommended.
- Thresholds are placeholders; check current FSSAI requirements.
- Rule engine flags are screening aids, never certification. The agent cannot declare a sample safe.
- SQLite file storage: data may reset when a hosted deployment restarts.
- No authentication; single-user prototype.
