function getBaseUrl() {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
  try {
    return new URL(base).origin;
  } catch {
    return 'http://localhost:4000';
  }
}

async function fetchJson(path, options = {}) {
  const url = getBaseUrl() + '/api/paper-trading' + path;
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

export function getPaperSetups() {
  return fetchJson('/setups');
}

export function getPaperState() {
  return fetchJson('/state');
}

export function resetPaperPortfolio() {
  return fetchJson('/reset', { method: 'POST', body: JSON.stringify({}) });
}

export function previewPaperSetup(body) {
  return fetchJson('/preview', { method: 'POST', body: JSON.stringify(body || {}) });
}

export function paperTick(body) {
  return fetchJson('/tick', { method: 'POST', body: JSON.stringify(body || {}) });
}

export function paperClose(body) {
  return fetchJson('/close', { method: 'POST', body: JSON.stringify(body || {}) });
}

export function getPaperTrades(params = {}) {
  const q = new URLSearchParams();
  if (params.month) q.set('month', String(params.month));
  if (params.year) q.set('year', String(params.year));
  if (params.setupId) q.set('setupId', String(params.setupId));
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.skip != null) q.set('skip', String(params.skip));
  if (params.tz) q.set('tz', String(params.tz));
  const query = q.toString();
  return fetchJson('/trades' + (query ? `?${query}` : ''));
}

export function getPaperTradesByMonth(params = {}) {
  const q = new URLSearchParams();
  if (params.year) q.set('year', String(params.year));
  if (params.tz) q.set('tz', String(params.tz));
  const query = q.toString();
  return fetchJson('/trades/by-month' + (query ? `?${query}` : ''));
}
