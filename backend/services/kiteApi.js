/**
 * Zerodha Kite Connect API client.
 * Token exchange uses SHA-256 checksum; api_secret used only server-side.
 */

import axios from 'axios';
import crypto from 'crypto';
import zlib from 'zlib';

const KITE_BASE = 'https://api.kite.trade';
const KITE_LOGIN = 'https://kite.zerodha.com/connect/login';

/**
 * SHA-256 checksum for /session/token.
 * Formula: SHA256(api_key + request_token + api_secret); no separator.
 */
function checksum(apiKey, requestToken, apiSecret) {
  const str = `${apiKey}${requestToken}${apiSecret}`;
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Build login URL for user to open in browser.
 * Optional redirect_params to track which user initiated login (e.g. state=userId).
 */
export function getLoginUrl(apiKey, redirectUri, redirectParams = {}) {
  const params = new URLSearchParams({
    api_key: apiKey,
    v: '3',
  });
  if (Object.keys(redirectParams).length > 0) {
    params.set('redirect_params', JSON.stringify(redirectParams));
  }
  return `${KITE_LOGIN}?${params.toString()}`;
}

/**
 * Once the request_token is obtained from the login flow, POST it to /session/token
 * to complete the token exchange and retrieve the access_token.
 *
 * Request (matches Kite spec):
 *   POST https://api.kite.trade/session/token
 *   Header: X-Kite-Version: 3
 *   Body (application/x-www-form-urlencoded): api_key, request_token, checksum
 *
 * Response: { status: "success", data: { access_token, user_id, user_name, ... } }
 * We return the full response; callers use data.data.access_token.
 */
export async function exchangeToken(apiKey, apiSecret, requestToken) {
  const url = `${KITE_BASE}/session/token`;
  const sum = checksum(apiKey, requestToken, apiSecret);
  let res;
  try {
    res = await axios.post(
      url,
      new URLSearchParams({
        api_key: apiKey,
        request_token: requestToken,
        checksum: sum,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Kite-Version': '3',
        },
        validateStatus: () => true,
      }
    );
  } catch (reqErr) {
    const data = reqErr.response?.data;
    let msg = 'Token exchange failed';
    if (typeof data === 'object' && data && (data.message || data.error_type))
      msg = data.message || data.error_type;
    else if (typeof data === 'string' && data.trim()) msg = data.trim();
    else if (reqErr.message && !/^Request failed with status code \d{3}$/.test(reqErr.message))
      msg = reqErr.message;
    throw new Error(msg);
  }
  const data = res.data;
  if (data?.status === 'error') {
    const msg = data?.message || data?.error_type || 'Token exchange failed';
    throw new Error(msg);
  }
  if (res.status !== 200) {
    const msg =
      (typeof data === 'object' && (data?.message || data?.error_type)) ||
      `Kite API returned ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Kite API GET. After authentication, all requests use:
 *   Authorization: token api_key:access_token
 * (e.g. curl -H "Authorization: token xxx:yyy")
 * When apiKey is missing (legacy session), falls back to Bearer access_token.
 */
async function kiteGet(accessToken, path, apiKey = null) {
  const url = path.startsWith('http') ? path : `${KITE_BASE}${path}`;
  const authHeader =
    apiKey != null && apiKey
      ? `token ${apiKey}:${accessToken}`
      : `Bearer ${accessToken}`;
  const res = await axios.get(url, {
    headers: {
      Authorization: authHeader,
      'X-Kite-Version': '3',
    },
    validateStatus: () => true,
  });
  const data = res.data;
  if (res.status !== 200) {
    const msg =
      (typeof data === 'object' && (data?.message || data?.error_type)) ||
      (typeof data === 'string' && data) ||
      `Kite API returned ${res.status}`;
    const err = new Error(msg);
    err.response = res;
    throw err;
  }
  if (data?.status === 'error') {
    const msg = data?.message || data?.error_type || 'Request failed';
    const err = new Error(msg);
    err.response = { status: res.status, data };
    throw err;
  }
  return data;
}

export async function getUserProfile(accessToken, apiKey = null) {
  return kiteGet(accessToken, '/user/profile', apiKey);
}

export async function getUserMargins(accessToken, apiKey = null) {
  return kiteGet(accessToken, '/user/margins', apiKey);
}

export async function getUserMarginsSegment(accessToken, segment, apiKey = null) {
  return kiteGet(accessToken, `/user/margins/${encodeURIComponent(segment)}`, apiKey);
}

/**
 * Parse CSV line handling quoted fields (e.g. name with commas).
 */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === ',' && !inQuotes) || (c === '\r' && !inQuotes)) {
      out.push(cur.trim());
      cur = '';
      if (c === '\r') break;
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * GET /instruments or /instruments/:exchange — returns gzipped CSV.
 * Parse to array of { instrument_token, tradingsymbol, name, exchange, ... }.
 */
export async function getInstruments(accessToken, apiKey, exchange = null) {
  const path = exchange
    ? `/instruments/${encodeURIComponent(exchange)}`
    : '/instruments';
  const url = `${KITE_BASE}${path}`;
  const authHeader =
    apiKey != null && apiKey
      ? `token ${apiKey}:${accessToken}`
      : `Bearer ${accessToken}`;
  const res = await axios.get(url, {
    headers: {
      Authorization: authHeader,
      'X-Kite-Version': '3',
    },
    responseType: 'arraybuffer',
    validateStatus: () => true,
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength: 50 * 1024 * 1024,
  });
  if (res.status !== 200) {
    const msg =
      (typeof res.data === 'string' && res.data) ||
      `Kite API returned ${res.status}`;
    const err = new Error(msg);
    err.response = res;
    throw err;
  }
  let csv = '';
  const buf = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data || []);
  const encoding = res.headers['content-encoding'];
  if (encoding === 'gzip' || (buf[0] === 0x1f && buf[1] === 0x8b)) {
    csv = zlib.gunzipSync(buf).toString('utf8');
  } else {
    csv = buf.toString('utf8');
  }
  const lines = csv.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return { instruments: [] };
  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine);
  const instruments = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, j) => {
      row[h] = values[j] !== undefined ? values[j] : '';
    });
    instruments.push(row);
  }
  return { instruments };
}
