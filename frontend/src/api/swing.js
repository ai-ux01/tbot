/**
 * Swing bot API – register, evaluate, status.
 */

function getBaseUrl() {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/kotak';
  try {
    return new URL(base).origin + '/api/swing';
  } catch {
    return 'http://localhost:4000/api/swing';
  }
}

async function fetchJson(path, options = {}) {
  const url = getBaseUrl() + path;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed: ${res.status}`);
    if (res.status === 401 && data.code === 'SESSION_EXPIRED') err.code = 'SESSION_EXPIRED';
    throw err;
  }
  return data;
}

/**
 * @param {{ sessionId: string, instrumentToken: string, instrument: { exchangeSegment?: string, tradingSymbol: string } }} body
 */
export async function swingStart(body) {
  const { sessionId, ...rest } = body;
  const res = await fetch(getBaseUrl() + '/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({ sessionId, ...rest }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed: ${res.status}`);
    if (res.status === 401 && data.code === 'SESSION_EXPIRED') err.code = 'SESSION_EXPIRED';
    throw err;
  }
  return data;
}

/**
 * Evaluate all registered instruments (no body), or single if sessionId + instrumentToken provided.
 * @param {{ sessionId?: string, instrumentToken?: string }} [body]
 */
export async function swingEvaluate(body = {}) {
  const { sessionId, instrumentToken } = body;
  const headers = { 'Content-Type': 'application/json' };
  if (sessionId) headers['X-Session-Id'] = sessionId;
  const res = await fetch(getBaseUrl() + '/evaluate', {
    method: 'POST',
    headers,
    body: JSON.stringify(sessionId != null && instrumentToken != null ? { sessionId, instrumentToken } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed: ${res.status}`);
    if (res.status === 401 && data.code === 'SESSION_EXPIRED') err.code = 'SESSION_EXPIRED';
    throw err;
  }
  return data;
}

export async function swingStatus() {
  return fetchJson('/status', { method: 'GET' });
}

/**
 * Run swing backtest (DB-only). Body: { symbols: [{ symbol }], from?, to?, capital? }
 * @returns {Promise<{ winRate: number, avgR: number, maxDrawdown: number, totalReturn: number, tradesCount: number, trades?: object[], error?: string }>}
 */
export async function swingBacktest(body) {
  const res = await fetch(getBaseUrl() + '/backtest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

/**
 * Reconcile broker positions with our swing store. Body: { sessionId }
 * @returns {Promise<{ success: boolean, brokerPositions: object[], ourPositions: object[], discrepancies: object[], error?: string }>}
 */
export async function swingReconcile(body) {
  const res = await fetch(getBaseUrl() + '/reconcile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(body?.sessionId ? { 'X-Session-Id': body.sessionId } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed: ${res.status}`);
    if (res.status === 401 && data.code === 'SESSION_EXPIRED') err.code = 'SESSION_EXPIRED';
    throw err;
  }
  return data;
}
