/**
 * Kotak API client – mirrors backend /api/kotak routes.
 * Session: { sessionId, baseUrl, neo? } — order POSTs also send `X-Session-Id` (app id) plus Neo `Auth`, `Sid`, `neo-fin-key`.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/kotak';

/** App MPIN session id; Express matches case-insensitively. */
const HDR_SESSION_ID = 'X-Session-Id';
const HDR_NEO_FIN_KEY = 'neo-fin-key';

export const SESSION_EXPIRED_CODE = 'SESSION_EXPIRED';

function getAuthHeaders(accessToken) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

function getSessionHeaders(session) {
  if (!session?.sessionId) throw new Error('No session');
  const h = new Headers();
  h.set('content-type', 'application/json');
  h.set(HDR_SESSION_ID, session.sessionId);
  return h;
}

function hasNeoCredentials(session) {
  const n = session?.neo;
  return !!(n && typeof n === 'object' && n.token && n.sid && n.baseUrl);
}

/**
 * Neo-style Auth, Sid, neo-fin-key. `Sid` must be Kotak Neo `sid` from MPIN (not app `sessionId`).
 * Fallback: app `sessionId` in Sid only if `neo` is missing (server store lookup by app id).
 */
function orderPostInit(session, jData) {
  if (!session?.sessionId && !hasNeoCredentials(session)) {
    throw new Error('No session: complete MPIN login first');
  }
  const jStr = typeof jData === 'string' ? jData : JSON.stringify(jData);
  const headers = new Headers();
  headers.set('Accept', 'application/json');
  headers.set('Content-Type', 'application/x-www-form-urlencoded');
  headers.set(HDR_NEO_FIN_KEY, 'neotradeapi');
  if (session?.sessionId) {
    headers.set(HDR_SESSION_ID, session.sessionId);
  }
  if (hasNeoCredentials(session)) {
    headers.set('Auth', session.neo.token);
    headers.set('Sid', session.neo.sid);
  } else if (session?.sessionId) {
    headers.set('Sid', session.sessionId);
  }
  const body = new URLSearchParams({ jData: jStr }).toString();
  return { headers, body };
}

async function handleRes(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed: ${res.status}`);
    if (res.status === 401 && data.code === SESSION_EXPIRED_CODE) {
      err.code = SESSION_EXPIRED_CODE;
    }
    throw err;
  }
  return data;
}

// --- Login ---

export async function totpLogin(accessToken, { mobileNumber, ucc, totp }) {
  const res = await fetch(`${API_BASE}/login/totp`, {
    method: 'POST',
    headers: getAuthHeaders(accessToken),
    body: JSON.stringify({ mobileNumber, ucc, totp }),
  });
  return handleRes(res);
}

export async function mpinValidate(accessToken, viewSid, viewToken, mpin) {
  const key = String(accessToken ?? '').replace(/^Bearer\s+/i, '').trim();
  const mpinHeaders = new Headers();
  mpinHeaders.set('Content-Type', 'application/json');
  mpinHeaders.set('Authorization', key);
  mpinHeaders.set('Sid', viewSid);
  mpinHeaders.set('Auth', viewToken);
  mpinHeaders.set(HDR_NEO_FIN_KEY, 'neotradeapi');
  const res = await fetch(`${API_BASE}/login/mpin`, {
    method: 'POST',
    headers: mpinHeaders,
    body: JSON.stringify({ mpin }),
  });
  return handleRes(res);
}

// --- Orders ---

export async function placeOrder(session, jData) {
  const { headers, body } = orderPostInit(session, jData);
  const res = await fetch(`${API_BASE}/orders/place`, {
    method: 'POST',
    headers,
    body,
  });
  return handleRes(res);
}

export async function modifyOrder(session, jData) {
  const { headers, body } = orderPostInit(session, jData);
  const res = await fetch(`${API_BASE}/orders/modify`, { method: 'POST', headers, body });
  return handleRes(res);
}

export async function cancelOrder(session, jData) {
  const { headers, body } = orderPostInit(session, jData || { am: 'NO' });
  const res = await fetch(`${API_BASE}/orders/cancel`, { method: 'POST', headers, body });
  return handleRes(res);
}

export async function exitCover(session, jData) {
  const { headers, body } = orderPostInit(session, jData || { am: 'NO' });
  const res = await fetch(`${API_BASE}/orders/exit-cover`, { method: 'POST', headers, body });
  return handleRes(res);
}

export async function exitBracket(session, jData) {
  const { headers, body } = orderPostInit(session, jData || { am: 'NO' });
  const res = await fetch(`${API_BASE}/orders/exit-bracket`, { method: 'POST', headers, body });
  return handleRes(res);
}

// --- Reports ---

export async function getOrderBook(session) {
  const res = await fetch(`${API_BASE}/reports/orders`, {
    headers: getSessionHeaders(session),
  });
  return handleRes(res);
}

export async function orderHistory(session, jData) {
  const { headers, body } = orderPostInit(session, jData || {});
  const res = await fetch(`${API_BASE}/reports/order-history`, { method: 'POST', headers, body });
  return handleRes(res);
}

export async function getTradeBook(session) {
  const res = await fetch(`${API_BASE}/reports/trades`, {
    headers: getSessionHeaders(session),
  });
  return handleRes(res);
}

export async function getPositions(session) {
  const res = await fetch(`${API_BASE}/reports/positions`, {
    headers: getSessionHeaders(session),
  });
  return handleRes(res);
}

export async function getHoldings(session) {
  const res = await fetch(`${API_BASE}/reports/holdings`, {
    headers: getSessionHeaders(session),
  });
  return handleRes(res);
}

// --- Quotes (only Authorization; no session) ---

export async function getQuotes(accessToken, baseUrl, exchangeSegment = 'nse_cm', symbol) {
  const url = `${API_BASE}/quotes?baseUrl=${encodeURIComponent(baseUrl)}&exchangeSegment=${encodeURIComponent(exchangeSegment)}&symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return handleRes(res);
}

export async function getScripmasterPaths(accessToken, baseUrl) {
  const url = `${API_BASE}/scripmaster/file-paths?baseUrl=${encodeURIComponent(baseUrl)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return handleRes(res);
}
