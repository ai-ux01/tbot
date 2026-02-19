# Application flow

## 1. Login flow (no broker tokens on frontend)

```
Frontend                          Backend                         Kotak
   |                                 |                               |
   |  1. Set access token (step 1)   |                               |
   |  2. POST /login/totp            |  POST tradeApiLogin            |
   |     (mobile, ucc, totp)         |  -------------------------->   |
   |  <-- viewToken, viewSid         |  <-- viewToken, viewSid        |
   |                                 |                               |
   |  3. POST /login/mpin            |  POST tradeApiValidate        |
   |     (viewToken, viewSid, mpin)  |  -------------------------->   |
   |                                 |  <-- auth, sid, baseUrl        |
   |                                 |  createSession() --> store    |
   |  <-- sessionId, baseUrl only    |  (auth/sid never sent)         |
   |  Store: { sessionId, baseUrl }  |                               |
```

- After login, frontend only has **sessionId** and **baseUrl**. Auth/sid stay in backend `sessionStore`.
- All later API calls send header **X-Session-Id**; backend resolves session from store.

---

## 2. Kotak API flow (orders, reports, etc.)

```
Frontend                    Backend
   |                           |
   |  Any Kotak API call       |
   |  Header: X-Session-Id     |
   |  ---------------------->  |
   |                           |  getSessionFromReq(req)
   |                           |  --> sessionStore.get(sessionId)
   |                           |  --> { auth, sid, baseUrl }
   |                           |  Kotak REST (auth, sid)
   |  <-- response             |
```

- 401 + code `SESSION_EXPIRED` → frontend calls `logout()` and user re-logins.

---

## 3. Intraday bot flow (start → live updates)

```
User clicks "Start bot" (sessionId + instrumentToken, optional strategies, risk, instrument)
        |
        v
Backend POST /api/bot/start
        |
        +-- getSession(sessionId) --> session from store
        +-- new BotEngine({ session, instrumentToken, risk?, instrument?, strategies?, strategyOptions? })
        +-- engine.start()
        |       |
        |       +-- DataFeed (WebSocket to Kotak HSM)
        |       |     tick --> CandleBuilder.addTick()
        |       +-- CandleBuilder: 1-min OHLC, every 60s emit candle
        |       +-- Strategies (one or more: emaCross, breakout, rsiReversal)
        |       |     candle --> each strategy.onCandle(candle, context)
        |       |     signal (BUY/SELL) --> RiskManager.approveTrade(signal, price, strategyName)
        |       |     --> OrderExecutor.placeMarketOrder() [if risk + instrument provided]
        |       +-- RiskManager tracks position per strategyName
        |
        +-- wireEngineToSocket(): DataFeed tick/candle, engine 'signal' (with strategyName),
        |   OrderExecutor positionUpdate, BotEngine status/circuitBreaker
        |   --> socket.emit('tick'|'candle'|'signal'|'positionUpdate'|'botStatus'|'circuitBreaker')
        |
        v
Frontend (Socket.IO client)
        |
        +-- on('tick')       --> livePrice
        +-- on('candle')     --> lastCandle / displayPrice
        +-- on('signal')     --> lastSignal (includes strategyName)
        +-- on('positionUpdate') --> position
        +-- on('botStatus')  --> botStatus
        +-- on('circuitBreaker') --> daily loss limit message
        |
        v
Bot live panel: Live price, Position, PnL, Bot status, Last signal
```

---

## 4. Intraday data flow (tick → candle → signal → order)

```
Kotak HSM WebSocket
        |
        |  tick (ltp, time, instrumentToken)
        v
DataFeed (backend)
        |
        v
CandleBuilder  --> 1-min OHLC, emit completed candle every 60s
        |
        v
Strategies (per strategy: emaCross, breakout, rsiReversal)
        |  --> strategy.onCandle(candle, context) returns { signal, state, candle, ... } or null
        v
RiskManager.approveTrade(signal, price, strategyName)  [position per strategy]
        |  --> position size, daily loss check, max daily loss = circuit breaker
        v
OrderExecutor.placeMarketOrder(side, qty, price)  [if approved]
        |  --> Kotak REST place order (session from store)
        v
Socket.IO  --> signal (with strategyName), positionUpdate, tradeOpened / tradeClosed
```

---

## 5. Multi-timeframe scanner (POST /api/bot/scan)

```
POST /api/bot/scan  Body: { sessionId, watchlist: string[] }
        |
        +-- getSession(sessionId)
        +-- ScannerService(session).scan(watchlist)
        |       For each instrument (sequential):
        |         Promise.all([ getHistorical(month), getHistorical(week), getHistorical(day) ])
        |         Strategy (EMA 9/21) on each → monthly/weekly isBullish(), daily lastSignal
        |         If macro bullish AND weekly bullish AND daily BUY → add to results
        |
        v
Return { success: true, results: [{ instrumentToken, trend: 'MULTI_TF_BULLISH', ... }] }
```

- Uses historical OHLC only (no WebSocket). Kotak historical endpoint may need to be configured in `kotakApi.getHistorical`.

---

## 6. Swing trading bot (daily, no ticks)

```
POST /api/swing/start   Body: { sessionId, instrumentToken, instrument: { exchangeSegment, tradingSymbol } }
        |
        +-- SwingPositionStore.register()  --> data/swing-registry.json
        +-- SwingSchedulerService.startScheduler()  --> cron 3:45 PM (IST) daily

POST /api/swing/evaluate  [optional body: { sessionId, instrumentToken } for single]
        |
        +-- For each registered instrument (or single): getSession(sessionId)
        +-- If usePortfolioSwingEngine (env USE_PORTFOLIO_SWING_ENGINE=true):
        |       PortfolioSwingEngine: liquidity (UniverseService) → regime (MarketRegimeService) →
        |       Strategy (EMA) → ExposureController → ATR sizing (PositionSizingService) →
        |       place order → SwingPositionStore + SwingTradeJournal (swing_trades)
        +-- Else: SwingEngine (legacy)
        |       Promise.all([ getHistorical(month), getHistorical(week), getHistorical(day) ])
        |       Strategy → entry/exit → SwingPositionStore, kotakApi.placeOrder
        |
        v
Socket.IO (optional): swingSignal, swingPositionUpdate, swingStatus

GET /api/swing/status  --> { success: true, positions: [...] }  (open positions from SwingPositionStore)
```

- Positions and registry in `data/swing-positions.json`, `data/swing-registry.json`. Survives server restart.
- No WebSocket; no CandleBuilder. Runs once per day (cron) or on manual evaluate.
- **Portfolio engine** (optional): liquidity filter, NIFTY regime filter, ATR position sizing, portfolio risk limits, trade journal to DB (`swing_trades`).

---

## 6a. Swing backtest & reconcile

```
POST /api/swing/backtest   Body: { symbols: [{ symbol }], from?, to?, capital? }
        |
        +-- DB only (no broker). HistoricalRepository.getHistoricalFromDb(symbol, 'day'|'week'|'month', from, to)
        +-- SwingBacktestService: EMA strategy, portfolio limits, ATR sizing simulation
        v
Return { winRate, avgR, maxDrawdown, totalReturn, tradesCount [, trades, error ] }

POST /api/swing/reconcile   Body: { sessionId }
        |
        +-- getSession(sessionId)
        +-- BrokerSyncService.reconcile(session): getHoldings + getPositions (Kotak)
        +-- Compare with SwingPositionStore + swing_trades OPEN
        v
Return { success, brokerPositions, ourPositions, discrepancies [] }
```

- Backtest requires historical candles in MongoDB `Candle` collection (symbol, timeframe, time).
- Reconcile logs discrepancies (missing on broker, extra on broker, quantity mismatch, DB journal mismatch).

---

## 7. AI Signals flow (pattern + indicators → signal → alert)

```
Frontend "AI Signals" tab
        |
        |  GET /api/signals?instrument=&timeframe=&limit=   --> list latest signals
        |  GET /api/signals/indicators?symbol=&timeframe=     --> indicators only (no ML)
        |  POST /api/signals/evaluate  Body: { instrument, timeframe }
        v
Backend routes/signals.js
        |
        +-- evaluateAndPersistSignal({ instrument, tradingsymbol, timeframe })
        |       |
        |       +-- getCandlesForSignal(symbol, timeframe)  --> Candle.find (by symbol or tradingsymbol), sort time asc, limit 500
        |       +-- IndicatorService.computeIndicators(ohlcv)  --> EMA 20/50/200, RSI, MACD, Bollinger, volume, ruleSignal, indicatorStrength
        |       +-- PatternService.predictPattern(ohlcv)  --> POST ML_SERVICE_URL/predict (optional; if disabled/unreachable → null)
        |       +-- confidence = 0.6×ML_probability + 0.4×indicatorStrength
        |       +-- resolveSignalType(ML, ruleSignal, trend)  --> BUY only if prob≥0.7, ruleSignal=BUY, trend=BULLISH; SELL analogous; else HOLD
        |       +-- ExplanationService.buildExplanation(pattern, indicators, lastCandles)  --> one-sentence text
        |       +-- Signal.create(signalDoc)  --> persist to MongoDB signals
        |       +-- If signal_type ∈ {BUY,SELL} and confidence ≥ 0.75  --> getAlertService().emit('signal', plain)
        |
        v
AlertService (EventEmitter)
        |
        +-- on('signal')  --> _onSignal(signalDoc)
        |       +-- Dedup: Alert in last 15 min same instrument/timeframe/signal_type → skip
        |       +-- Alert.create(signalId, instrument, timeframe, signal_type, confidence)
        |       +-- If ALERT_WEBHOOK_URL  --> POST webhook JSON; set webhookSent
        |       +-- Set delivered = true
        v
Frontend: table of signals (instrument, timeframe, signal_type, confidence %, pattern, explanation, time); 30s polling
```

- **ML service (optional):** Python FastAPI on port 8000; `POST /predict` with candles returns `{ pattern, probability, trend_prediction }`. If `ML_SERVICE_URL` unset or `disabled`, no HTTP call; pattern/trend then rule-based mock in Node or in Python.
- **Data:** Candles from MongoDB `Candle` (e.g. synced via NSE Sync / Kite stored-candles). Instrument can be tradingsymbol (e.g. RELIANCE) or instrument token.
- **Alerts:** Only for BUY/SELL with confidence ≥ 0.75; 15-minute dedup per instrument/timeframe/signal_type.

---

## 8. Architecture layers (swing / portfolio)

| Layer    | Components |
|----------|------------|
| **Data** | HistoricalRepository (broker + DB), UniverseService (liquidity: minPrice, minAvgVolume), DataIntegrityService |
| **Strategy** | SwingStrategy (EMA in bot/Strategy.js), IntradayStrategy (strategies/) |
| **Portfolio** | PortfolioRiskManager, PositionSizingService (ATR), ExposureController |
| **Execution** | OrderExecutor (intraday), kotakApi.placeOrder (swing), BrokerSyncService |

- Config: `config/tradingConfig.js` (riskPerTrade, maxOpenPositions, maxPortfolioExposure, minPrice, minAvgVolume, enableMarketRegimeFilter, etc.).

---

## 9. Graceful shutdown

```
SIGTERM / SIGINT
        |
        v
server.js shutdown()
        |
        +-- routes/bot shutdownBot()  --> engine.stop(), clear snapshot
        +-- SwingSchedulerService.stopScheduler()  --> cron stopped
        +-- io.close()
        +-- server.close()
        v
process.exit(0)
```

---

## 10. Where things live

| What                    | Location |
|-------------------------|----------|
| Session (auth/sid)      | Backend only: `sessionStore.js`, keyed by sessionId |
| Frontend session        | `{ sessionId, baseUrl }` in SessionContext / sessionStorage |
| Config                  | `config/tradingConfig.js` (risk, liquidity, regime, ATR, usePortfolioSwingEngine) |
| Intraday bot engine     | Backend: `bot/BotEngine.js`, created on POST /api/bot/start |
| Strategies              | `strategies/` (emaCross, breakout, rsiReversal); `bot/Strategy.js` (EMA for swing) |
| Swing engine (legacy)   | `engine/SwingEngine.js`; used when usePortfolioSwingEngine is false |
| Portfolio swing engine  | `engine/PortfolioSwingEngine.js`; liquidity → regime → strategy → risk → ATR → order → journal |
| Swing state             | `services/SwingPositionStore.js` → data/swing-positions.json, data/swing-registry.json |
| Swing trade journal     | `database/models/SwingTrade.js` (swing_trades), `services/SwingTradeJournal.js` |
| Data layer              | HistoricalRepository, UniverseService, DataIntegrityService |
| Portfolio layer         | PositionSizingService (ATR), PortfolioRiskManager, ExposureController |
| Market regime           | `services/MarketRegimeService.js` (NIFTY 50 monthly EMA) |
| Broker sync             | `services/BrokerSyncService.js`; POST /api/swing/reconcile |
| Backtest (swing)        | `services/SwingBacktestService.js`; POST /api/swing/backtest (DB only) |
| Scanner                 | `services/ScannerService.js`; POST /api/bot/scan |
| Live updates            | Socket.IO: tick, candle, signal, positionUpdate, botStatus, circuitBreaker |
| Swing socket events     | swingSignal, swingPositionUpdate, swingStatus |
| Error boundary          | App root: `ErrorBoundary` in `App.jsx` |
| **AI Signals**          | |
| Signals API             | `routes/signals.js`: GET /api/signals, GET /api/signals/indicators, POST /api/signals/evaluate |
| Signal engine           | `services/SignalEngine.js`: getCandlesForSignal, evaluateAndPersistSignal (indicators + optional ML → score → persist) |
| Indicators              | `services/IndicatorService.js`: EMA, RSI, MACD, Bollinger, volume, ruleSignal, indicatorStrength |
| Pattern (ML client)    | `services/PatternService.js`: POST to ML_SERVICE_URL/predict (optional; skip if URL empty/disabled) |
| Explanation             | `services/ExplanationService.js`: template-based sentence from pattern + indicators |
| Alert engine            | `services/AlertService.js`: EventEmitter, on('signal') → dedup, Alert.create, optional webhook |
| Signal / Alert models   | `database/models/Signal.js`, `database/models/Alert.js` (MongoDB) |
| ML service (optional)   | `ml-service/`: FastAPI app.py (POST /predict), preprocess.py, model.py (mock or LSTM); port 8000 |
| Signals UI              | Frontend: `components/SignalsPanel.jsx`, `api/signals.js`; tab "AI Signals" |

---

## Quick “view all flow” checklist

1. **Login** – LoginFlow → TOTP → MPIN → backend returns sessionId + baseUrl only.
2. **Intraday bot** – Bot live panel → POST /api/bot/start (sessionId, instrumentToken, optional strategies, risk, instrument). Socket.IO: tick, candle, signal, positionUpdate, botStatus, circuitBreaker.
3. **Scanner** – POST /api/bot/scan with sessionId + watchlist → multi-timeframe bullish results.
4. **Swing bot** – POST /api/swing/start to register; cron 3:45 PM IST or POST /api/swing/evaluate; GET /api/swing/status. Socket: swingSignal, swingPositionUpdate, swingStatus. Optional PortfolioSwingEngine (liquidity, regime, ATR, portfolio risk, swing_trades journal) when USE_PORTFOLIO_SWING_ENGINE=true.
5. **Swing backtest** – POST /api/swing/backtest with symbols (DB candles required). Returns winRate, avgR, maxDrawdown, totalReturn, tradesCount.
6. **Swing reconcile** – POST /api/swing/reconcile with sessionId; compare broker vs SwingPositionStore and DB; returns discrepancies.
7. **Orders** – Intraday: Strategy → RiskManager → OrderExecutor. Swing: SwingEngine or PortfolioSwingEngine → kotakApi.placeOrder, SwingPositionStore, optional SwingTradeJournal.
8. **Re-login** – Any 401 with `code: SESSION_EXPIRED` → logout() and show login again.
9. **Shutdown** – SIGTERM/SIGINT → stop intraday bot, stop swing scheduler, close Socket.IO, close HTTP server.
10. **AI Signals** – GET /api/signals (list), GET /api/signals/indicators (indicators only), POST /api/signals/evaluate (instrument + timeframe). Pipeline: candles from DB → IndicatorService → optional ML /predict → confidence & signal_type → ExplanationService → Signal persisted; if BUY/SELL and confidence ≥ 0.75 → AlertService (dedup, Alert doc, optional webhook). Frontend: "AI Signals" tab, 30s polling.
