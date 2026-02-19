# Deep Code Explanation: AI Trading Signals System

## 1. Architecture Overview

The system has three layers:

1. **AI Agent layer**
   - **IndicatorService** (Node): rule-based indicators.
   - **PatternService** (Node): HTTP client to optional ML service.
   - **ExplanationService** (Node): builds human-readable text from pattern + indicators.

2. **Signal Engine** (Node)
   Combines ML output (when present), rule signal, and trend into one confidence score and a final BUY/SELL/HOLD. Persists to MongoDB and can trigger alerts.

3. **Alert Engine** (Node)
   Event-driven: listens for high-confidence BUY/SELL, writes alerts, optional webhook, dedupes in time window.

Data flow: **Candles (MongoDB)** → **IndicatorService** → **PatternService (optional ML)** → **SignalEngine** (score + rules) → **ExplanationService** → **Signal document** → **AlertService** (if BUY/SELL and confidence ≥ 0.75).

---

## 2. IndicatorService (`backend/services/IndicatorService.js`)

**Role:** From an array of OHLCV candles, compute technical indicators and a single **ruleSignal** (BUY / SELL / HOLD). No external TA libraries; all math is inline.

**Input:** Array of `{ open, high, low, close, volume }`.
**Output:**
`{ ema20, ema50, ema200, rsi, macd, bollingerBands, volumeSignal, ruleSignal, indicatorStrength }`.

**Core helpers:**

- **SMA:** `sma(arr, period)` = mean of last `period` values. Used for Bollinger middle and as EMA seed.
- **EMA:** `emaSeries(data, period)`
  - `k = 2 / (period + 1)`.
  - First value = SMA of first `period` points.
  - Then `ema[i] = data[i] * k + ema[i-1] * (1 - k)`.
  Only the last value is used for EMA20/50/200.

- **RSI (Wilder):**
  - Initial avg gain/loss over first `period` changes.
  - Rolling: `avgGain = (avgGain*(period-1) + gain) / period`, same for loss.
  - `RS = avgGain/avgLoss`, `RSI = 100 - 100/(1+RS)`.
  Returns the last RSI (0–100).

- **MACD:**
  - Fast EMA(12), Slow EMA(26) on closes.
  - MACD line = fast − slow.
  - Signal = EMA(9) of the MACD line.
  - Histogram = MACD − Signal.
  Returns `{ macd, signal, histogram, bullish }` (bullish = histogram > 0).

- **Bollinger Bands:**
  - Middle = SMA(20) of last 20 closes.
  - Std dev on same 20 closes; upper = middle + 2×std, lower = middle − 2×std.
  - `position`: last close vs bands → `'below' | 'above' | 'inside'`.

- **Volume breakout:**
  - Current volume vs SMA(volume, 20).
  - If current ≥ 1.5× average → `'breakout'`, else `'normal'`.

**Rule signal (computeRuleSignal):**
Scores BUY and SELL from conditions:

- EMA20 > EMA50 → buyScore++; EMA20 < EMA50 → sellScore++.
- EMA50 > EMA200 → buyScore++; else sellScore++.
- RSI < 30 → buyScore++; RSI > 70 → sellScore++.
- MACD bullish → buyScore++; bearish → sellScore++.
- Price below lower BB → buyScore++; above upper BB → sellScore++.
- Volume breakout → both get +0.5.

**Result:**
- BUY if buyScore > sellScore and buyScore ≥ 2.
- SELL if sellScore > buyScore and sellScore ≥ 2.
- Otherwise HOLD.

**Indicator strength (indicatorStrengthScore):**
Scalar in [0, 1] for the Signal Engine: base 0.5; +0.2 for BUY, −0.2 for SELL; +0.15 if RSI < 30 or > 70; +0.1 if MACD histogram non-zero; then clamped to [0,1].

---

## 3. SignalEngine (`backend/services/SignalEngine.js`)

**Role:** Run the full pipeline for one instrument/timeframe: load candles → indicators → optional ML → combine into one signal → explain → save → optionally trigger alert.

**getCandlesForSignal(symbol, timeframe, limit):**
- If `symbol` is numeric (instrument token), filter by `Candle.symbol`.
- Else treat as tradingsymbol: `$or` of `symbol` and `tradingsymbol` (case-insensitive regex, escaped).
- Sort by `time` ascending, limit 500, return `{ open, high, low, close, volume, time }[]`.

**resolveSignalType(mlResult, ruleSignal, trendPrediction):**
- BUY only if: ML probability ≥ 0.7 **and** ruleSignal === 'BUY' **and** trend === 'BULLISH'.
- SELL only if: probability ≥ 0.7 **and** ruleSignal === 'SELL' **and** trend === 'BEARISH'.
- Otherwise HOLD.

**evaluateAndPersistSignal({ instrument, tradingsymbol, timeframe }):**
1. Load up to 500 candles (oldest first).
2. If < 50 candles, log and return null.
3. Build OHLCV array; run **IndicatorService.computeIndicators(ohlcv)**.
4. Call **PatternService.predictPattern(ohlcv)** (optional ML). On failure or disabled ML, `mlResult` is null.
5. Trend = `mlResult.trend_prediction` or 'NEUTRAL'; ruleSignal from indicators.
6. **Confidence:**
   `(mlResult.probability ?? 0) * 0.6 + (indicators.indicatorStrength ?? 0.5) * 0.4`
   then clamped to [0, 1].
7. **Signal type** = resolveSignalType(mlResult, ruleSignal, trendPrediction).
8. **ExplanationService.buildExplanation** with pattern, indicators, last 10 candles, instrument name.
9. Build signal document (instrument, tradingsymbol, timeframe, signal_type, confidence, explanation, pattern, trend_prediction, indicators, candleTime).
10. **Signal.create(signalDoc)** → persist.
11. If signal_type is BUY or SELL and confidence ≥ 0.75, **getAlertService().emit('signal', plain)**.
12. Return the saved document (plain object).

So: ML is optional; when it's missing, confidence still uses indicator strength and signal type can still be HOLD or, in theory, BUY/SELL if rules and trend align (trend from ML is then NEUTRAL unless you set it elsewhere).

---

## 4. PatternService (`backend/services/PatternService.js`)

**Role:** HTTP client to the Python ML service. Optional: if no URL or URL is `''` or `'disabled'`, it never calls the network and returns `null`.

**Config:**
- `ML_SERVICE_URL`: empty or `'disabled'` → skip; else default `http://localhost:8000`.
- `ML_SERVICE_TIMEOUT_MS` (default 10000), `ML_SERVICE_RETRIES` (default 2).

**predictPattern(candles):**
- If no URL or < 50 candles, return null.
- Payload: last 500 candles as `{ open, high, low, close, volume }`.
- POST to `{ML_URL}/predict` with retries and backoff (500ms × (attempt+1)).
- Response must have numeric `probability`; then return `{ pattern, probability (clamped 0–1), trend_prediction (uppercase) }`.
- On all failures, log and return null (SignalEngine continues without ML).

---

## 5. ExplanationService (`backend/services/ExplanationService.js`)

**Role:** Turn pattern + indicators + last candles into one short, human-readable sentence. Template-based (no LLM in current code).

**buildExplanation(opts):**
- opts: `pattern`, `indicators`, `lastCandles`, `instrument`.
- Builds sentences:
  - Price above/below EMA50 (value).
  - RSI at X indicating oversold/overbought/neutral momentum.
  - AI detected {pattern} with Y% confidence (if pattern + probability present).
  - Trend prediction: …
  - Optional prefix `[instrument]`.
- Returns a single string joined by `. ` or `'No explanation available.'`.

---

## 6. AlertService (`backend/services/AlertService.js`)

**Role:** Event-driven alerting: when a high-confidence BUY/SELL is persisted, save an alert, optionally POST to a webhook, and avoid duplicate alerts in a time window.

**Singleton:** `getAlertService()` returns one `AlertService` instance (extends EventEmitter).

**On registration:** The service does `this.on('signal', this._onSignal)`. So when SignalEngine does `getAlertService().emit('signal', plain)`, `_onSignal` runs.

**_onSignal(signalDoc):**
- Ignore if missing or signal_type === 'HOLD'.
- **Dedup:** Find an Alert in last 15 minutes with same instrument, timeframe, signal_type. If found, log "duplicate suppressed" and return.
- **Alert.create** with signalId, instrument, timeframe, signal_type, confidence.
- If `ALERT_WEBHOOK_URL` is set: POST JSON `{ event: 'trading_signal', instrument, timeframe, signal_type, confidence, explanation, pattern }` (timeout 5s). On success, set alert's webhookSent.
- Set alert's delivered = true.
- Any error is logged; no throw (so SignalEngine isn't broken by alert failures).

---

## 7. Mongoose Models

**Signal** (`backend/database/models/Signal.js`):
- instrument, tradingsymbol, timeframe (required).
- signal_type: enum BUY | SELL | HOLD.
- confidence: number, required, min 0, max 1.
- explanation (string).
- pattern: { name, probability }.
- trend_prediction.
- indicators: { ema20, ema50, ema200, rsi, ruleSignal, indicatorStrength }.
- candleTime (Date).
- timestamps.
- Indexes: (instrument, timeframe, createdAt desc), (signal_type, createdAt desc).

**Alert** (`backend/database/models/Alert.js`):
- signalId (ObjectId ref Signal), instrument, timeframe, signal_type (BUY|SELL), confidence.
- delivered, webhookSent (booleans).
- timestamps.
- Index: (instrument, timeframe, signal_type, createdAt desc).

---

## 8. API Routes (`backend/routes/signals.js`)

- **GET /api/signals**
  Query: instrument, timeframe, limit (default 50, max 100).
  Finds signals with optional filter, sort by createdAt desc, limit, `.lean()`, returns `{ signals: list }`.
  Requires DB connected (503 otherwise).

- **GET /api/signals/indicators**
  Query: symbol (or instrument), timeframe (default 'day'), limit (default 500, clamped 50–500).
  Loads candles via getCandlesForSignal, runs IndicatorService.computeIndicators, returns `{ indicators, count }` or `{ indicators: null, message, count }` if < 20 candles.

- **POST /api/signals/evaluate**
  Body: instrument (or tradingsymbol), optional tradingsymbol, timeframe (default 'day').
  Calls evaluateAndPersistSignal; 400 if missing instrument/timeframe, 422 if insufficient candles, 500 on other errors.
  Returns the saved signal document.

On load, the router calls `getAlertService()` so the AlertService singleton and its `'signal'` listener are registered.

---

## 9. ML Service (Python, `ml-service/`)

**app.py (FastAPI):**
- **GET /health** → `{ "status": "ok" }`.
- **POST /predict:** Body = `{ candles: [ { open, high, low, close, volume } ] }`.
  - Requires ≥ 50 candles.
  - Converts to list of dicts, runs **prepare_predict_input** (preprocess), then **model.predict(X, model)**.
  - Returns **PredictResponse**: pattern (str), probability (float), trend_prediction (str).
  - Model is lazy-loaded once (get_model() → load_or_mock()).

**preprocess.py:**
- **ohlcv_to_features(candles, seq_len=60, num_features=5):**
  - Builds array of [open, high, low, close, volume], last `seq_len` rows.
  - MinMaxScaler per column (0–1).
  - Returns `(X, scaler)` with X shape (1, seq_len, 5).
- **prepare_predict_input(candles, seq_len=60, max_candles=500):**
  - Uses last `max_candles` candles, calls ohlcv_to_features, returns X only (for inference).

**model.py:**
- **Without TensorFlow:** Always uses **_mock_predict(X)**.
  - Uses last 20 closes from X (feature index 3 = close).
  - Return = (close[-1]-close[0])/(close[0]+1e-8).
  - ret > 0.02 → BULLISH, Bullish Flag, prob = 0.6 + |ret|*5 capped at 0.95.
  - ret < -0.02 → BEARISH, Bearish Flag, same prob formula.
  - Else NEUTRAL, Consolidation, prob 0.5.
- **With TensorFlow:**
  - **load_or_mock():** If ML_MODEL_PATH file exists, load Keras model; else return None (so predict uses mock).
  - **build_model():** LSTM(64) → Dropout(0.2) → LSTM(32) → Dense(16, relu) → Dense(3, softmax). Input shape (seq_len, 5).
  - **predict(X, model):** If model and TF available, model.predict(X), argmax → trend index, max prob → probability, pattern name from PATTERNS list; on exception falls back to _mock_predict.

So "optionally ML" means: if the service is not running or URL is disabled, Node uses no ML; if the service is running but no saved model, Python uses the rule-based mock; if a saved model is present, Python uses the LSTM.

---

## 10. Frontend (React)

**api/signals.js:**
- getBaseUrl() from VITE_API_BASE_URL or localhost:4000.
- getSignals(params): GET /api/signals with query (instrument, timeframe, limit).
- getIndicators(params): GET /api/signals/indicators (symbol, timeframe, limit).
- evaluateSignal(body): POST /api/signals/evaluate with { instrument, tradingsymbol?, timeframe }.

**SignalsPanel.jsx:**
- State: signals list, loading, error, instrumentFilter, timeframeFilter, evaluating, evalForm (instrument, timeframe).
- fetchSignals: calls getSignals with filters, sets signals or error.
- useEffect: fetchSignals on mount and every 30s (polling).
- Evaluate form: instrument + timeframe (1D/1H); on submit calls evaluateSignal then fetchSignals.
- Table: instrument, timeframe, signal_type (colored), confidence %, pattern (name + prob), explanation (truncated), createdAt (IST).
- Copy and styling aligned with existing panels (bot-live-*, muted).

---

## 11. End-to-End Data Flow (Evaluate)

1. User submits symbol (e.g. RELIANCE) and timeframe (e.g. day) in the UI.
2. Frontend POSTs to /api/signals/evaluate.
3. Backend: getCandlesForSignal resolves by tradingsymbol or token, loads up to 500 candles from Candle collection.
4. IndicatorService computes EMA, RSI, MACD, BB, volume, ruleSignal, indicatorStrength.
5. PatternService POSTs last 500 candles to ML service /predict (or skips if disabled).
6. SignalEngine: confidence = 0.6×ML_prob + 0.4×indicatorStrength; signal_type = resolveSignalType(ML, rule, trend).
7. ExplanationService builds one-sentence explanation.
8. Signal document saved to MongoDB.
9. If signal is BUY/SELL and confidence ≥ 0.75, AlertService receives 'signal' event, dedupes, creates Alert, optionally webhooks.
10. Response returns the signal document; UI refreshes the list (and polling keeps it updated).
