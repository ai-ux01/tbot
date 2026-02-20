# AI Signals Setup

## Overview

- **Backend (Node.js):** IndicatorService (EMA, RSI, MACD, Bollinger, volume), SignalEngine (combines ML + rules), AlertService (event-driven, webhook), REST APIs under `/api/signals`.
- **ML service (Python FastAPI):** Optional. When used, run on **port 8000**. Provides `/predict` for pattern and trend. If not running or `ML_SERVICE_URL` is unset/disabled, the backend uses a rule-based mock and signals still work.
- **Frontend (React):** "AI Signals" tab lists signals, filter by instrument/timeframe, "Evaluate" runs the pipeline for a symbol.

## Quick start

1. **Backend:** Ensure MongoDB is set (e.g. `MONGODB_URI` in `backend/.env`). Start: `cd backend && npm start`.
2. **ML service (optional, port 8000):** To use real ML predictions: `cd ml-service && pip install -r requirements.txt && uvicorn app:app --reload --port 8000`, and set `ML_SERVICE_URL=http://localhost:8000` in backend `.env`. If you skip this, signals still run with rule-based pattern/trend.
3. **Frontend:** `cd frontend && npm run dev`. Open the "AI Signals" tab.

## APIs

- `GET /api/signals?instrument=&timeframe=&limit=50` – list signals
- `GET /api/signals/indicators?symbol=&timeframe=&limit=500` – indicators only (no ML)
- `POST /api/signals/evaluate` – body `{ "instrument": "RELIANCE", "timeframe": "day" }` – full pipeline and persist

## Evaluate

Requires stored candles for the symbol (e.g. sync from NSE Sync or Stored Data). Instrument can be tradingsymbol (e.g. RELIANCE) or instrument token. Alerts fire when signal is BUY/SELL and confidence ≥ 0.75 (optional webhook via `ALERT_WEBHOOK_URL`).

## ML training (optional)

See **[HOW_TO_TRAIN.md](./HOW_TO_TRAIN.md)** for full steps. Quick options:

- **UI:** Train AI tab → Start training (requires ML service running: `npm run ml`).
- **API:** `POST /api/signals/train` (backend proxies to ML service).
- **CLI:** `cd ml-service && .venv/bin/python train.py` (saves `saved_model.keras`).

## Docker

- Backend: `docker build -t bot-ai-backend ./backend`
- ML: `docker build -t bot-ai-ml ./ml-service`

Run with MongoDB and optional Redis as needed.
