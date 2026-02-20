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
