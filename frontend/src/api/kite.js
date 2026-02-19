/**
 * Zerodha Kite Connect API – login URL, profile, margins, logout.
 * Uses X-Kite-Session-Id header from sessionStorage (set after redirect) so it works cross-origin (e.g. frontend 5173, backend 4000).
 */

const KITE_SID_KEY = 'kite_sid';

export function getStoredKiteSessionId() {
  try {
    return typeof window !== 'undefined' ? sessionStorage.getItem(KITE_SID_KEY) : null;
  } catch {
    return null;
  }
}

export function setStoredKiteSessionId(sid) {
  try {
    if (typeof window !== 'undefined') {
      if (sid) sessionStorage.setItem(KITE_SID_KEY, sid);
      else sessionStorage.removeItem(KITE_SID_KEY);
    }
  } catch (_) {}
}



function getKiteBaseUrl() {
  const base = import.meta.env.VITE_KITE_API_BASE_URL ?? import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
  try {
    return new URL(base).origin;
  } catch {
    return 'http://localhost:4000';
  }
}

function kiteHeaders(sessionIdOverride = null) {
  const headers = { 'Content-Type': 'application/json' };
  const sid = sessionIdOverride ?? getStoredKiteSessionId();
  if (sid) headers['X-Kite-Session-Id'] = String(sid).trim();
  return headers;
}

async function kiteFetch(path, options = {}) {
  const url = getKiteBaseUrl() + '/api/kite' + path;
  const sidOverride = options.kiteSessionId ?? null;
  const { kiteSessionId: _skip, headers: optHeaders, ...rest } = options;
  const res = await fetch(url, {
    ...rest,
    credentials: 'include',
    headers: { ...kiteHeaders(sidOverride), ...optHeaders },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.code === 'KITE_SESSION_EXPIRED') setStoredKiteSessionId(null);
    const err = new Error(data.error || `Request failed: ${res.status}`);
    if (data.hint) err.hint = data.hint;
    if (res.status === 401 && data.code === 'KITE_SESSION_EXPIRED') err.code = 'KITE_SESSION_EXPIRED';
    throw err;
  }
  return data;
}

/**
 * When Kite redirects to the frontend (redirect_uri set to frontend URL), call this with request_token from URL.
 * Returns { kite_sid }; store it and use for X-Kite-Session-Id.
 */
export async function completeKiteLogin(requestToken) {
  console.log('requestToken????>>', requestToken);
  const url = getKiteBaseUrl() + '/api/kite/complete-login';
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_token: requestToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Complete login failed');
  return data;
}

/** GET /api/kite/login-url – returns { loginUrl } to redirect user to Kite login */
export async function getKiteLoginUrl(redirectParams = null) {
  const url = getKiteBaseUrl() + '/api/kite/login-url';
  const query = redirectParams ? `?redirect_params=${encodeURIComponent(JSON.stringify(redirectParams))}` : '';
  const res = await fetch(url + query, { credentials: 'include', headers: kiteHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Failed to get login URL');
    if (data.hint) err.hint = data.hint;
    throw err;
  }
  return data;
}

/** GET /api/kite/profile – requires Kite session (header or cookie). Pass kiteSessionId to use a session id directly. */
export async function getKiteProfile(kiteSessionId = null) {
  return kiteFetch('/profile', kiteSessionId != null ? { kiteSessionId } : {});
}

/** GET /api/kite/margins */
export async function getKiteMargins() {
  return kiteFetch('/margins');
}

/** GET /api/kite/margins/:segment */
export async function getKiteMarginsSegment(segment) {
  return kiteFetch(`/margins/${encodeURIComponent(segment)}`);
}

/**
 * NSE display filter: keep only instruments that match
 * exchange=NSE, segment=NSE, instrument_type=EQ, lot_size=1,
 * name non-empty, and name does not contain "%" or "SDL".
 * @param {Array<{ exchange?: string, segment?: string, instrument_type?: string, lot_size?: string|number, name?: string }>} list
 * @returns {Array} Filtered list (items that pass the filter).
 */
export function filterNseDisplayInstruments(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((i) => {
    if (String(i.exchange || '').toUpperCase() !== 'NSE') return false;
    if (String(i.segment || '').toUpperCase() !== 'NSE') return false;
    if (String(i.instrument_type || '').toUpperCase() !== 'EQ') return false;
    if (String(i.lot_size ?? '') !== '1') return false;
    const name = String(i.name || '').trim();
    if (!name) return false;
    if (name.includes('%')) return false;
    if (name.includes('SDL')) return false;
    return true;
  });
}

/**
 * GET /api/kite/instruments or /api/kite/instruments/:exchange
 * Returns { instruments: Array<{ instrument_token, tradingsymbol, name, exchange, ... }> }
 */
export async function getKiteInstruments(exchange = null) {
  const path = exchange ? `/instruments/${encodeURIComponent(exchange)}` : '/instruments';
  return kiteFetch(path);
}

/**
 * POST /api/kite/historical
 * Body: { instrumentToken, interval, from, to, options?: { continuous?: 0|1, oi?: 0|1 } }
 * Returns: { candles: Array<{ timestamp, open, high, low, close, volume, oi? }> }
 */
export async function getKiteHistorical(body) {
  const url = getKiteBaseUrl() + '/api/kite/historical';
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: kiteHeaders(),
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.code === 'KITE_SESSION_EXPIRED') setStoredKiteSessionId(null);
    const err = new Error(data.error || 'Historical fetch failed');
    if (res.status === 401 && data.code === 'KITE_SESSION_EXPIRED') err.code = 'KITE_SESSION_EXPIRED';
    throw err;
  }
  return data;
}

/**
 * GET /api/kite/stored-candles/summary
 * Returns { totalCandles, byTimeframe, symbolCount, sampleSymbols } (no Kite session required).
 */
export async function getStoredCandlesSummary() {
  const url = getKiteBaseUrl() + '/api/kite/stored-candles/summary';
  const res = await fetch(url, { credentials: 'include', headers: kiteHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.hint || 'Failed to load summary');
  return data;
}

/**
 * GET /api/kite/stored-candles/symbols-rsi?timeframe=day&period=14
 * Returns { symbols: Array<{ symbol, tradingsymbol, rsi }>, timeframe, period }.
 */
export async function getStoredCandlesSymbolsRsi(params = {}) {
  const sp = new URLSearchParams();
  if (params.timeframe) sp.set('timeframe', params.timeframe);
  if (params.period != null) sp.set('period', String(params.period));
  const url = getKiteBaseUrl() + '/api/kite/stored-candles/symbols-rsi' + (sp.toString() ? '?' + sp.toString() : '');
  const res = await fetch(url, { credentials: 'include', headers: kiteHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to load symbols RSI');
  return data;
}

/**
 * GET /api/kite/stored-candles?symbol=&timeframe=&limit=
 * Returns { candles } (no Kite session required).
 */
export async function getStoredCandles(params = {}) {
  const sp = new URLSearchParams();
  if (params.symbol) sp.set('symbol', params.symbol);
  if (params.tradingsymbol) sp.set('tradingsymbol', params.tradingsymbol);
  if (params.timeframe) sp.set('timeframe', params.timeframe);
  if (params.limit != null) sp.set('limit', String(params.limit));
  const url = getKiteBaseUrl() + '/api/kite/stored-candles' + (sp.toString() ? '?' + sp.toString() : '');
  const res = await fetch(url, { credentials: 'include', headers: kiteHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.hint || 'Failed to load candles');
  return data;
}

/**
 * POST /api/kite/sync-nse-historical
 * Syncs NSE equity 1h + 1d for last 5 years to DB.
 * Body: { limit?: number, instrument_token?: string, tradingsymbol?: string }
 * Returns { ok, instruments, candlesDay, candles60m, errors }
 */
export async function syncNseHistorical(options = {}) {
  const url = getKiteBaseUrl() + '/api/kite/sync-nse-historical';
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { ...kiteHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(options ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.code === 'KITE_SESSION_EXPIRED') setStoredKiteSessionId(null);
    const err = new Error(data.error || 'Sync failed');
    if (res.status === 401 && data.code === 'KITE_SESSION_EXPIRED') err.code = 'KITE_SESSION_EXPIRED';
    throw err;
  }
  return data;
}

/** POST /api/kite/logout */
export async function kiteLogout() {
  const url = getKiteBaseUrl() + '/api/kite/logout';
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: kiteHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Logout failed');
  setStoredKiteSessionId(null);
  return data;
}
