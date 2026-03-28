/**
 * Build monthly OHLCV from stored daily candles (UTC calendar month boundaries).
 * @param {Array<{ open, high, low, close, volume?, time }>} dailyCandles - oldest first
 * @returns {Array<{ open, high, low, close, volume, time }>}
 */
export function aggregateDailyToMonthly(dailyCandles) {
  if (!Array.isArray(dailyCandles) || dailyCandles.length === 0) return [];
  const sorted = [...dailyCandles].sort((a, b) => {
    const ta = a?.time ? new Date(a.time).getTime() : 0;
    const tb = b?.time ? new Date(b.time).getTime() : 0;
    return ta - tb;
  });
  /** @type {Map<string, typeof sorted>} */
  const byMonth = new Map();
  for (const c of sorted) {
    if (c?.time == null) continue;
    const d = new Date(c.time);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(c);
  }
  const keys = [...byMonth.keys()].sort();
  const out = [];
  for (const key of keys) {
    const bars = byMonth.get(key);
    if (!bars?.length) continue;
    const first = bars[0];
    const last = bars[bars.length - 1];
    let high = -Infinity;
    let low = Infinity;
    let vol = 0;
    for (const b of bars) {
      const h = Number(b.high);
      const l = Number(b.low);
      if (Number.isFinite(h)) high = Math.max(high, h);
      if (Number.isFinite(l)) low = Math.min(low, l);
      vol += Number(b.volume) || 0;
    }
    const open = Number(first.open);
    const close = Number(last.close);
    if (!Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(high) || !Number.isFinite(low)) continue;
    out.push({
      open,
      high,
      low,
      close,
      volume: vol,
      time: last.time,
    });
  }
  return out;
}

/**
 * @param {string} raw - query/body value
 * @returns {'day' | 'month'}
 */
export function normalizeBacktestSeries(raw) {
  const s = String(raw ?? 'day')
    .trim()
    .toLowerCase();
  if (s === 'month' || s === 'monthly' || s === '1m') return 'month';
  return 'day';
}
