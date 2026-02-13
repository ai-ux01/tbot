/**
 * Kotak API client – mirrors backend /api/kotak routes.
 * Session is { sessionId, baseUrl }; broker tokens never reach the frontend.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/kotak';

export const SESSION_EXPIRED_CODE = 'SESSION_EXPIRED';

function getAuthHeaders(accessToken) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

function getSessionHeaders(session) {
  if (!session?.sessionId) throw new Error('No session');
  return {
    'Content-Type': 'application/json',
    'X-Session-Id': session.sessionId,
  };
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
  const res = await fetch(`${API_BASE}/login/mpin`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(accessToken),
      sid: viewSid,
      auth: viewToken,
      'neo-fin-key': 'neotradeapi',
    },
    body: JSON.stringify({ mpin }),
  });
  return handleRes(res);
}

// --- Orders ---

export async function placeOrder(session, jData) {
  const res = await fetch(`${API_BASE}/orders/place`, {
    method: 'POST',
    headers: getSessionHeaders(session),
    body: JSON.stringify({ jData }),
  });
  return handleRes(res);
}

export async function modifyOrder(session, jData) {
  const res = await fetch(`${API_BASE}/orders/modify`, {
    method: 'POST',
    headers: getSessionHeaders(session),
    body: JSON.stringify({ jData }),
  });
  return handleRes(res);
}

export async function cancelOrder(session, jData) {
  const res = await fetch(`${API_BASE}/orders/cancel`, {
    method: 'POST',
    headers: getSessionHeaders(session),
    body: JSON.stringify({ jData: jData || { am: 'NO' } }),
  });
  return handleRes(res);
}

export async function exitCover(session, jData) {
  const res = await fetch(`${API_BASE}/orders/exit-cover`, {
    method: 'POST',
    headers: getSessionHeaders(session),
    body: JSON.stringify({ jData: jData || { am: 'NO' } }),
  });
  return handleRes(res);
}

export async function exitBracket(session, jData) {
  const res = await fetch(`${API_BASE}/orders/exit-bracket`, {
    method: 'POST',
    headers: getSessionHeaders(session),
    body: JSON.stringify({ jData: jData || { am: 'NO' } }),
  });
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
  const res = await fetch(`${API_BASE}/reports/order-history`, {
    method: 'POST',
    headers: getSessionHeaders(session),
    body: JSON.stringify({ jData: jData || {} }),
  });
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
