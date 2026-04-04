import { KOTAK_LOGIN_BASE, NEO_FIN_KEY } from '../config.js';
import { SessionExpiredError } from '../errors.js';

/** Neo trade JWT / sid must not include Bearer or stray whitespace (common copy-paste issues). */
export function normalizeNeoAuthToken(auth) {
  if (auth == null) return '';
  let s = String(auth).trim();
  if (/^Bearer\s+/i.test(s)) s = s.replace(/^Bearer\s+/i, '').trim();
  return s;
}

export function normalizeNeoSid(sid) {
  if (sid == null) return '';
  return String(sid).trim();
}

/** Kotak docs: https host, no trailing slash (we normalize before each request). */
export function normalizeKotakBaseUrl(baseUrl) {
  if (baseUrl == null || !String(baseUrl).trim()) return '';
  let s = String(baseUrl).trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}

// Kotak login APIs expect raw consumer key in Authorization (no "Bearer " prefix).
const defaultHeaders = (accessToken) => ({
  'Authorization': accessToken,
  'neo-fin-key': NEO_FIN_KEY,
  'Content-Type': 'application/json',
});

/** Outbound Neo session calls: match curl samples (Auth, Sid, neo-fin-key, Accept). */
const NEO_HTTP_UA =
  process.env.KOTAK_HTTP_USER_AGENT ||
  'Mozilla/5.0 (compatible; NeoTradeAPI/1.0; +https://github.com/nodejs/undici)';

function sessionHeaders(auth, sid) {
  const a = normalizeNeoAuthToken(auth);
  const s = normalizeNeoSid(sid);
  return {
    Accept: 'application/json',
    Auth: a,
    Sid: s,
    'neo-fin-key': NEO_FIN_KEY,
    'User-Agent': NEO_HTTP_UA,
  };
}

/**
 * Neo order APIs expect form field jData = JSON string (same as curl --data-urlencode jData='{...}').
 * Accept a plain object (we stringify) or an already-serialized JSON string (validated, not re-stringified).
 */
function jDataToNeoFormString(jData) {
  if (jData == null) throw new Error('jData is required');
  if (typeof jData === 'string') {
    const t = jData.trim();
    if (!t) throw new Error('jData is required');
    try {
      JSON.parse(t);
    } catch {
      throw new Error('jData must be valid JSON when sent as a string');
    }
    return t;
  }
  if (typeof jData === 'object' && !Array.isArray(jData)) {
    return JSON.stringify(jData);
  }
  throw new Error('jData must be a plain object or JSON string');
}

/** Turn Kotak error payload (string or object) into a single string for Error message. */
function toErrorString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Neo often returns { errMsg, stat, stCode } (e.g. 100008 unauthorized) — avoid opaque JSON.stringify in errors. */
function neoApiErrorSummary(data, httpStatus) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const errMsg = data.errMsg != null ? String(data.errMsg).trim() : '';
    const stat = data.stat != null ? String(data.stat) : '';
    const stCode = data.stCode;
    if (errMsg || stat || stCode != null) {
      const bits = [];
      if (errMsg) bits.push(errMsg);
      if (stat && stat !== 'Ok') bits.push(`stat=${stat}`);
      if (stCode != null) bits.push(`stCode=${stCode}`);
      return bits.join(' · ');
    }
  }
  return toErrorString(data?.message ?? data?.error ?? data) || `HTTP ${httpStatus}`;
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
 * Neo order POSTs (place/modify/cancel/…): per Kotak spec
 *   POST {baseUrl}/quick/order/...
 *   Headers: Accept: application/json, Auth, Sid, neo-fin-key: neotradeapi,
 *            Content-Type: application/x-www-form-urlencoded
 *   Body: URL-encoded field jData = stringified JSON object.
 * `auth` / `sid` / `baseUrl` come from MPIN `tradeApiValidate` (`data.token`, `data.sid`, `data.baseUrl`).
 * Use the **Trade** JWT from MPIN — a **View**-only token will fail order APIs.
 */
async function postForm(baseUrl, path, auth, sid, jData) {
  const root = normalizeKotakBaseUrl(baseUrl);
  if (!root) throw new Error('Kotak baseUrl is missing');
  const url = root + path;
  const body = new URLSearchParams({ jData: jDataToNeoFormString(jData) }).toString();
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
      const detail = neoApiErrorSummary(data, res.status);
      throw new SessionExpiredError(
        `Kotak Neo rejected the broker session (${detail}). Run MPIN login again; broker tokens expire independently of this app.`,
      );
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
  const root = normalizeKotakBaseUrl(baseUrl);
  if (!root) throw new Error('Kotak baseUrl is missing');
  const url = root + path;
  const res = await fetch(url, {
    method: 'GET',
    headers: sessionHeaders(auth, sid),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403 || res.status === 401) {
      const detail = neoApiErrorSummary(data, res.status);
      throw new SessionExpiredError(
        `Kotak Neo rejected the broker session (${detail}). Run MPIN login again; broker tokens expire independently of this app.`,
      );
    }
    const msg = toErrorString(data.message ?? data.error ?? data) || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// --- Orders (Neo: POST .../quick/order/... + x-www-form-urlencoded jData={...}) ---

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
  const root = normalizeKotakBaseUrl(baseUrl);
  if (!root) throw new Error('Kotak baseUrl is missing');
  const url = root + path;
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
  const root = normalizeKotakBaseUrl(baseUrl);
  if (!root) throw new Error('Kotak baseUrl is missing');
  const url = root + path;
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
