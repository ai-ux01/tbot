/**
 * Bot API – start/stop bot on the backend.
 */

function getBaseUrl() {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/kotak';
  try {
    return new URL(base).origin + '/api/bot';
  } catch {
    return 'http://localhost:4000/api/bot';
  }
}

async function fetchJson(path, options = {}) {
  const url = getBaseUrl() + path;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export async function startBot(body) {
  const res = await fetch(getBaseUrl() + '/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed: ${res.status}`);
    if (res.status === 401 && data.code === 'SESSION_EXPIRED') err.code = 'SESSION_EXPIRED';
    throw err;
  }
  return data;
}

export async function stopBot() {
  return fetchJson('/stop', { method: 'POST' });
}

export async function getBotStatus() {
  return fetchJson('/status', { method: 'GET' });
}
