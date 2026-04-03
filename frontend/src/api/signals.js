/**
 * Signals API: list signals, get indicators, evaluate (run AI + rules pipeline).
 */

function getBaseUrl() {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
  try {
    return new URL(base).origin;
  } catch {
    return 'http://localhost:4000';
  }
}

async function fetchJson(path, options = {}) {
  const url = getBaseUrl() + '/api/signals' + path;
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || 'Request failed');
    err.code = res.status;
    throw err;
  }
  return data;
}

/**
 * GET /api/signals?instrument=&timeframe=&limit=
 */
export async function getSignals(params = {}) {
  const q = new URLSearchParams();
  if (params.instrument) q.set('instrument', params.instrument);
  if (params.timeframe) q.set('timeframe', params.timeframe);
  if (params.limit != null) q.set('limit', String(params.limit));
  const query = q.toString();
  return fetchJson(query ? `?${query}` : '');
}

/**
 * GET /api/signals/combined?instrument=&limit=
 * One row per instrument: combined signal = BUY only if both 1D and 1H BUY, SELL only if both SELL, else HOLD.
 */
export async function getSignalsCombined(params = {}) {
  const q = new URLSearchParams();
  if (params.instrument) q.set('instrument', params.instrument);
  if (params.limit != null) q.set('limit', String(params.limit));
  const query = q.toString();
  return fetchJson('/combined' + (query ? `?${query}` : ''));
}

/**
 * GET /api/signals/rsi-setup?symbol=&timeframe=
 * Evaluate RSI Setup strategy. Returns { signal_type, confidence?, reason?, structure?, count }.
 */
export async function getRsiSetup(params = {}) {
  const q = new URLSearchParams();
  const symbol = params.symbol ?? params.instrument;
  if (symbol) q.set('symbol', symbol);
  if (params.timeframe) q.set('timeframe', params.timeframe);
  if (params.mode) q.set('mode', String(params.mode));
  if (params.low1Min != null && params.low1Min !== '') q.set('low1Min', String(params.low1Min));
  if (params.low1Max != null && params.low1Max !== '') q.set('low1Max', String(params.low1Max));
  if (params.reboundMin != null && params.reboundMin !== '') q.set('reboundMin', String(params.reboundMin));
  if (params.reboundMax != null && params.reboundMax !== '') q.set('reboundMax', String(params.reboundMax));
  if (params.maTouchTolerance != null && params.maTouchTolerance !== '') q.set('maTouchTolerance', String(params.maTouchTolerance));
  if (params.maTouchAboveSlack != null && params.maTouchAboveSlack !== '') q.set('maTouchAboveSlack', String(params.maTouchAboveSlack));
  const query = q.toString();
  return fetchJson('/rsi-setup' + (query ? `?${query}` : ''));
}

/**
 * GET /api/signals/rsi-setup/combined?limit=
 * RSI Setup for all symbols with stored candles (1D only). Returns { signals }.
 */
export async function getRsiSetupCombined(params = {}) {
  const q = new URLSearchParams();
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.mode) q.set('mode', String(params.mode));
  if (params.low1Min != null && params.low1Min !== '') q.set('low1Min', String(params.low1Min));
  if (params.low1Max != null && params.low1Max !== '') q.set('low1Max', String(params.low1Max));
  if (params.reboundMin != null && params.reboundMin !== '') q.set('reboundMin', String(params.reboundMin));
  if (params.reboundMax != null && params.reboundMax !== '') q.set('reboundMax', String(params.reboundMax));
  if (params.maTouchTolerance != null && params.maTouchTolerance !== '') q.set('maTouchTolerance', String(params.maTouchTolerance));
  if (params.maTouchAboveSlack != null && params.maTouchAboveSlack !== '') q.set('maTouchAboveSlack', String(params.maTouchAboveSlack));
  const query = q.toString();
  return fetchJson('/rsi-setup/combined' + (query ? `?${query}` : ''));
}

/**
 * POST /api/signals/rsi-setup/backtest
 * Body: { symbol, maxHoldingDays?, minPrice?, maxPrice? }. Last daily close must be in range if bounds set.
 */
export async function postRsiSetupBacktest(body) {
  return fetchJson('/rsi-setup/backtest', {
    method: 'POST',
    body: JSON.stringify(body || {}),
  });
}

/**
 * GET /api/signals/rsi-setup/backtest/combined?limit=&maxHoldingDays=&minPrice=&maxPrice=
 * Run RSI Setup backtest on all stored symbols (1D). Returns { summary, results, maxHoldingDays, minPrice, maxPrice }.
 */
export async function getRsiSetupBacktestCombined(params = {}) {
  const q = new URLSearchParams();
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.maxHoldingDays != null) q.set('maxHoldingDays', String(params.maxHoldingDays));
  if (params.minPrice != null) q.set('minPrice', String(params.minPrice));
  if (params.maxPrice != null) q.set('maxPrice', String(params.maxPrice));
  if (params.mode) q.set('mode', String(params.mode));
  if (params.low1Min != null && params.low1Min !== '') q.set('low1Min', String(params.low1Min));
  if (params.low1Max != null && params.low1Max !== '') q.set('low1Max', String(params.low1Max));
  if (params.reboundMin != null && params.reboundMin !== '') q.set('reboundMin', String(params.reboundMin));
  if (params.reboundMax != null && params.reboundMax !== '') q.set('reboundMax', String(params.reboundMax));
  if (params.maTouchTolerance != null && params.maTouchTolerance !== '') q.set('maTouchTolerance', String(params.maTouchTolerance));
  if (params.maTouchAboveSlack != null && params.maTouchAboveSlack !== '') q.set('maTouchAboveSlack', String(params.maTouchAboveSlack));
  const query = q.toString();
  return fetchJson('/rsi-setup/backtest/combined' + (query ? `?${query}` : ''));
}

/**
 * GET /api/signals/eighty-percent/combined?limit=
 * 80% Setup for all symbols (1D). Returns { signals, checkedCount }.
 */
export async function getEightyPercentCombined(params = {}) {
  const q = new URLSearchParams();
  if (params.limit != null) q.set('limit', String(params.limit));
  const query = q.toString();
  return fetchJson('/eighty-percent/combined' + (query ? `?${query}` : ''));
}

/**
 * POST /api/signals/eighty-percent/backtest — Body: { symbol, maxHoldingDays? }.
 */
export async function postEightyPercentBacktest(body) {
  return fetchJson('/eighty-percent/backtest', {
    method: 'POST',
    body: JSON.stringify(body || {}),
  });
}

/**
 * GET /api/signals/eighty-percent/backtest/combined?limit=&maxHoldingDays=
 */
export async function getEightyPercentBacktestCombined(params = {}) {
  const q = new URLSearchParams();
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.maxHoldingDays != null) q.set('maxHoldingDays', String(params.maxHoldingDays));
  if (params.series != null && params.series !== '') q.set('series', String(params.series));
  const query = q.toString();
  return fetchJson('/eighty-percent/backtest/combined' + (query ? `?${query}` : ''));
}

/**
 * GET /api/signals/rsi-ma-setup-copy/combined?limit=
 * Copy of RSI↓MA setup (1D).
 */
export async function getRsiMaSetupCopyCombined(params = {}) {
  const q = new URLSearchParams();
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.liveOnly === true || params.liveOnly === 1 || params.liveOnly === '1') {
    q.set('liveOnly', 'true');
  }
  if (params.profitTargetPct != null && params.profitTargetPct !== '') {
    q.set('profitTargetPct', String(params.profitTargetPct));
  }
  if (params.rsiRemainderExit != null && params.rsiRemainderExit !== '') {
    q.set('rsiRemainderExit', String(params.rsiRemainderExit));
  }
  if (params.partialTpFraction != null && params.partialTpFraction !== '') {
    q.set('partialTpFraction', String(params.partialTpFraction));
  }
  if (params.minStockPrice != null && params.minStockPrice !== '') {
    q.set('minStockPrice', String(params.minStockPrice));
  }
  if (params.maxStockPrice != null && params.maxStockPrice !== '') {
    q.set('maxStockPrice', String(params.maxStockPrice));
  }
  const query = q.toString();
  return fetchJson('/rsi-ma-setup-copy/combined' + (query ? `?${query}` : ''));
}

/**
 * POST /api/signals/rsi-ma-setup-copy/backtest
 */
export async function postRsiMaSetupCopyBacktest(body) {
  return fetchJson('/rsi-ma-setup-copy/backtest', {
    method: 'POST',
    body: JSON.stringify(body || {}),
  });
}

/**
 * GET /api/signals/rsi-ma-setup-copy/backtest/combined
 */
export async function getRsiMaSetupCopyBacktestCombined(params = {}) {
  const q = new URLSearchParams();
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.maxHoldingDays != null) q.set('maxHoldingDays', String(params.maxHoldingDays));
  if (params.series != null && params.series !== '') q.set('series', String(params.series));
  if (params.profitTargetPct != null && params.profitTargetPct !== '') {
    q.set('profitTargetPct', String(params.profitTargetPct));
  }
  if (params.rsiRemainderExit != null && params.rsiRemainderExit !== '') {
    q.set('rsiRemainderExit', String(params.rsiRemainderExit));
  }
  if (params.partialTpFraction != null && params.partialTpFraction !== '') {
    q.set('partialTpFraction', String(params.partialTpFraction));
  }
  if (params.minStockPrice != null && params.minStockPrice !== '') {
    q.set('minStockPrice', String(params.minStockPrice));
  }
  if (params.maxStockPrice != null && params.maxStockPrice !== '') {
    q.set('maxStockPrice', String(params.maxStockPrice));
  }
  const query = q.toString();
  return fetchJson('/rsi-ma-setup-copy/backtest/combined' + (query ? `?${query}` : ''));
}

/**
 * GET /api/signals/ema-crossover/combined?limit=
 * EMA 10/20 crossover for all symbols with stored candles (1H). Returns { signals, checkedCount }. Also persists results to DB.
 */
export async function getEmaCrossoverCombined(params = {}) {
  const q = new URLSearchParams();
  if (params.limit != null) q.set('limit', String(params.limit));
  const query = q.toString();
  return fetchJson('/ema-crossover/combined' + (query ? `?${query}` : ''));
}

/**
 * GET /api/signals/ema-crossover/backtest?timeframe=day&symbol=&limit=&minPrice=&maxPrice=&capital=
 * Backtest EMA 10/20 on 1D stored candles. capital = max amount (default 10000). Returns { summary, results }.
 */
export async function getEmaCrossoverBacktest(params = {}) {
  const q = new URLSearchParams();
  if (params.timeframe) q.set('timeframe', params.timeframe);
  if (params.symbol) q.set('symbol', params.symbol);
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.capital != null && params.capital !== '') q.set('capital', String(params.capital));
  if (params.minPrice != null && params.minPrice !== '') q.set('minPrice', String(params.minPrice));
  if (params.maxPrice != null && params.maxPrice !== '') q.set('maxPrice', String(params.maxPrice));
  const query = q.toString();
  return fetchJson('/ema-crossover/backtest' + (query ? `?${query}` : ''));
}

/**
 * POST /api/signals/ema-crossover/persist
 * Persist a single EMA crossover signal (e.g. from live WebSocket). Body: { instrument, tradingsymbol?, signal_type, entryPrice?, explanation }.
 */
export async function persistEmaCrossoverSignal(body) {
  return fetchJson('/ema-crossover/persist', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * GET /api/signals/indicators?symbol=&timeframe=&limit=
 */
export async function getIndicators(params = {}) {
  const q = new URLSearchParams();
  const symbol = params.symbol ?? params.instrument;
  if (symbol) q.set('symbol', symbol);
  if (params.timeframe) q.set('timeframe', params.timeframe);
  if (params.limit != null) q.set('limit', String(params.limit));
  const query = q.toString();
  return fetchJson('/indicators' + (query ? `?${query}` : ''));
}

/**
 * POST /api/signals/evaluate
 * Body: { instrument, tradingsymbol?, timeframe }
 */
export async function evaluateSignal(body) {
  return fetchJson('/evaluate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * POST /api/signals/evaluate-all
 * Run analysis on all symbols with stored candles (1D + 1H). Returns { evaluated, errors, symbolCount }.
 */
export async function evaluateAllSignals() {
  return fetchJson('/evaluate-all', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/**
 * POST /api/signals/train
 * Trigger ML model training. Returns { status, message?, stdout? }.
 */
export async function trainModel() {
  return fetchJson('/train', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
