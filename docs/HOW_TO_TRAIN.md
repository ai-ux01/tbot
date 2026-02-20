# How to Train the AI Model

This guide explains how to train the LSTM trend classifier used by AI Signals. The model predicts trend (BULLISH / BEARISH / NEUTRAL) from OHLCV candle sequences.

---

## Prerequisites

- **Python 3.9+** with a virtual environment in `ml-service/`
- **TensorFlow** (installed via `requirements.txt`)
- **ML service** runs on port **8000** by default; backend uses it when `ML_SERVICE_URL` is set

---

## One-time setup

From the project root:

```bash
cd ml-service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

This installs FastAPI, uvicorn, numpy, scikit-learn, pydantic, and **TensorFlow**. If you see *"TensorFlow not installed"*, run:

```bash
.venv/bin/pip install "tensorflow>=2.15.0"
```

---

## Option 1: Train from the UI

1. **Start the ML service** (in a separate terminal, keep it running):
   ```bash
   npm run ml
   ```
   You should see: `Uvicorn running on http://0.0.0.0:8000`.

2. **Start backend and frontend** (if not already):
   - Backend: `npm run backend` (or `cd backend && npm run dev`)
   - Frontend: `npm run frontend` (or `cd frontend && npm run dev`)

3. **Set backend env** (so the backend can reach the ML service):
   - In `backend/.env`: `ML_SERVICE_URL=http://localhost:8000`  
   - If unset, the default is `http://localhost:8000`.

4. Open the app, go to the **Train AI** tab, and click **Start training**.  
   Training runs for about 1–2 minutes (synthetic data, 10 epochs). When it finishes, the UI shows *"Model saved"* and any script output.

---

## Option 2: Train via API

With the **backend** and **ML service** both running:

```bash
curl -X POST http://localhost:4000/api/signals/train
```

Success response (200):

```json
{
  "status": "ok",
  "message": "Model saved",
  "stdout": "..."
}
```

- **502 Bad Gateway:** ML service not running. Start it with `npm run ml`.
- **503:** Backend has no `ML_SERVICE_URL`. Set it in `backend/.env`.
- **500:** Training failed; check ML service logs or `stdout` in the response.

---

## Option 3: Train from the command line (Python)

You can run the training script directly without the API:

```bash
cd ml-service
.venv/bin/python train.py
```

- By default the model is saved as **`saved_model.keras`** in `ml-service/`.
- To use another path: `ML_MODEL_PATH=/path/to/model.keras .venv/bin/python train.py`

After training, **restart the ML service** (`npm run ml`) so it loads the new model. If you used the API or UI to train, the in-memory model is cleared automatically and the next `/predict` loads the new file.

---

## What the training script does

- **Data:** Uses **synthetic** OHLCV data (random-walk style) by default. No CSV or real market data is required for this demo.
- **Model:** LSTM-based classifier (see `ml-service/model.py`). Input: sequences of features from the last N candles; output: BULLISH (0), BEARISH (1), NEUTRAL (2).
- **Output:** Model is saved to `saved_model.keras` (or `ML_MODEL_PATH`). The ML service loads it for `/predict`; the backend uses `/predict` when evaluating AI Signals.

---

## Troubleshooting

| Issue | What to do |
|-------|------------|
| **TensorFlow not installed** | In `ml-service`: `.venv/bin/pip install tensorflow>=2.15.0` (or `pip install -r requirements.txt`). |
| **Port 8000 already in use** | Stop the process: `kill $(lsof -ti:8000)`. Or run the ML service on another port (e.g. `uvicorn app:app --port 8001`) and set `ML_SERVICE_URL=http://localhost:8001` in the backend. |
| **502 when clicking Start training** | Start the ML service in another terminal: `npm run ml`. |
| **503 when calling /api/signals/train** | Set `ML_SERVICE_URL=http://localhost:8000` (or your ML service URL) in `backend/.env`. |
| **Training very slow** | Normal for CPU. The script uses 800 samples and 10 epochs; reduce epochs in `train.py` if needed. |

---

## Summary

| Goal | Command / step |
|------|----------------|
| Install deps (incl. TensorFlow) | `cd ml-service && .venv/bin/pip install -r requirements.txt` |
| Start ML service | `npm run ml` (from project root) |
| Train from UI | Open **Train AI** tab → **Start training** |
| Train from API | `curl -X POST http://localhost:4000/api/signals/train` |
| Train from CLI | `cd ml-service && .venv/bin/python train.py` |
| Model file | `ml-service/saved_model.keras` (or `ML_MODEL_PATH`) |
