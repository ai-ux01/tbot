import { KOTAK_LOGIN_BASE, NEO_FIN_KEY } from '../config.js';
import { SessionExpiredError } from '../errors.js';

// Kotak login APIs expect raw consumer key in Authorization (no "Bearer " prefix).
const defaultHeaders = (accessToken) => ({
  'Authorization': accessToken,
  'neo-fin-key': NEO_FIN_KEY,
  'Content-Type': 'application/json',
});

const sessionHeaders = (auth, sid) => ({
  'Auth': auth,
  'Sid': sid,
  'neo-fin-key': NEO_FIN_KEY,
});

/** Turn Kotak error payload (string or object) into a single string for Error message. */
function toErrorString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * 1) TOTP Login → returns viewToken + viewSid
 */
export async function totpLogin(accessToken, { mobileNumber, ucc, totp }) {
  const res = await fetch(`${KOTAK_LOGIN_BASE}/tradeApiLogin`, {
    method: 'POST',
    headers: defaultHeaders(accessToken),
    body: JSON.stringify({ mobileNumber, ucc, totp }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = toErrorString(data.message ?? data.error ?? data) || `Login failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * 2) MPIN Validate → returns session token (Auth) + session sid (Sid) + baseUrl
 * Kotak expects: Authorization: <consumer_key> (no Bearer), sid, Auth (viewToken), body: { mpin }
 */
export async function mpinValidate(accessToken, viewSid, viewToken, mpin) {
  const res = await fetch(`${KOTAK_LOGIN_BASE}/tradeApiValidate`, {
    method: 'POST',
    headers: {
      ...defaultHeaders(accessToken),
      'sid': viewSid,
      'Auth': viewToken,
    },
    body: JSON.stringify({ mpin }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = toErrorString(data.message ?? data.error ?? data) || `MPIN validate failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * POST with application/x-www-form-urlencoded and jData
 */
async function postForm(baseUrl, path, auth, sid, jData) {
  const url = baseUrl.replace(/\/$/, '') + path;
  const body = new URLSearchParams({ jData: JSON.stringify(jData) }).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...sessionHeaders(auth, sid),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403 || res.status === 401) {
      throw new SessionExpiredError(toErrorString(data.message ?? data.error ?? data) || 'Session expired');
    }
    const msg = toErrorString(data.message ?? data.error ?? data) || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * GET with Auth + Sid
 */
async function get(baseUrl, path, auth, sid) {
  const url = baseUrl.replace(/\/$/, '') + path;
  const res = await fetch(url, {
    method: 'GET',
    headers: sessionHeaders(auth, sid),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403 || res.status === 401) {
      throw new SessionExpiredError(toErrorString(data.message ?? data.error ?? data) || 'Session expired');
    }
    const msg = toErrorString(data.message ?? data.error ?? data) || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// --- Orders ---

export async function placeOrder(baseUrl, auth, sid, jData) {
  return postForm(baseUrl, '/quick/order/rule/ms/place', auth, sid, jData);
}

export async function modifyOrder(baseUrl, auth, sid, jData) {
  return postForm(baseUrl, '/quick/order/vr/modify', auth, sid, jData);
}

export async function cancelOrder(baseUrl, auth, sid, jData) {
  return postForm(baseUrl, '/quick/order/cancel', auth, sid, jData);
}

export async function exitCover(baseUrl, auth, sid, jData) {
  return postForm(baseUrl, '/quick/order/co/exit', auth, sid, jData);
}

export async function exitBracket(baseUrl, auth, sid, jData) {
  return postForm(baseUrl, '/quick/order/bo/exit', auth, sid, jData);
}

// --- Reports ---

export async function getOrderBook(baseUrl, auth, sid) {
  return get(baseUrl, '/quick/user/orders', auth, sid);
}

export async function orderHistory(baseUrl, auth, sid, jData) {
  return postForm(baseUrl, '/quick/order/history', auth, sid, jData);
}

export async function getTradeBook(baseUrl, auth, sid) {
  return get(baseUrl, '/quick/user/trades', auth, sid);
}

export async function getPositions(baseUrl, auth, sid) {
  return get(baseUrl, '/quick/user/positions', auth, sid);
}

export async function getHoldings(baseUrl, auth, sid) {
  return get(baseUrl, '/portfolio/v1/holdings', auth, sid);
}

// --- Quotes (only Authorization; no neo-fin-key, Auth, Sid) ---

export async function getQuotes(baseUrl, accessToken, exchangeSegment, symbol) {
  const path = `/script-details/1.0/quotes/neosymbol/${exchangeSegment}|${symbol}/all`;
  const url = baseUrl.replace(/\/$/, '') + path;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': accessToken },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = toErrorString(data.message ?? data.error ?? data) || `Quotes failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// --- Historical OHLC (for Scanner) ---
// Kotak Neo may not expose this path; replace with actual historical/OHLC endpoint or external data source if needed.

/**
 * Fetch historical OHLC candles for an instrument.
 * @param {string} baseUrl - Session baseUrl
 * @param {string} auth - Session auth
 * @param {string} sid - Session sid
 * @param {{ instrumentToken: string, interval: 'day'|'week'|'month', lookbackMonths: number }} opts
 * @returns {Promise<Array<{ time: number, open: number, high: number, low: number, close: number }>>}
 */
export async function getHistorical(baseUrl, auth, sid, opts) {
  const { instrumentToken, interval, lookbackMonths = 12 } = opts ?? {};
  if (!instrumentToken || !interval) {
    throw new Error('getHistorical: instrumentToken and interval required');
  }
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - (lookbackMonths || 12));
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  const path = `/instruments/1.0/historical?instrumentToken=${encodeURIComponent(instrumentToken)}&interval=${encodeURIComponent(interval)}&from=${fromStr}&to=${toStr}`;
  const data = await get(baseUrl, path, auth, sid);
  return normalizeHistoricalResponse(data, interval);
}

/** Normalize Kotak or generic response to { time, open, high, low, close }[] */
function normalizeHistoricalResponse(data, interval) {
  if (!data || typeof data !== 'object') return [];
  const candles = data.data?.candles ?? data.candles ?? data;
  if (!Array.isArray(candles)) return [];
  return candles.map((c) => {
    if (c && typeof c.time !== 'undefined' && typeof c.close !== 'undefined') {
      return {
        time: Number(c.time),
        open: Number(c.open ?? c.close),
        high: Number(c.high ?? c.close),
        low: Number(c.low ?? c.close),
        close: Number(c.close),
      };
    }
    if (Array.isArray(c)) {
      const [t, o, h, l, cl] = c;
      return { time: Number(t), open: Number(o), high: Number(h), low: Number(l), close: Number(cl) };
    }
    return null;
  }).filter(Boolean);
}

// --- Scripmaster (only Authorization) ---

export async function getScripmasterPaths(baseUrl, accessToken) {
  const path = '/script-details/1.0/masterscrip/file-paths';
  const url = baseUrl.replace(/\/$/, '') + path;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': accessToken },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = toErrorString(data.message ?? data.error ?? data) || `Scripmaster failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}
