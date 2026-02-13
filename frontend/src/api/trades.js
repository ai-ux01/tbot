/**
 * Trade Journal API – GET /api/trades
 */

function getTradesUrl() {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/kotak';
  try {
    return new URL(base).origin + '/api/trades';
  } catch {
    return 'http://localhost:4000/api/trades';
  }
}

export async function getTrades() {
  const res = await fetch(getTradesUrl());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}
