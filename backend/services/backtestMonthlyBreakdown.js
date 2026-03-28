/**
 * Per-calendar-month stats for sequential backtests: group by exit candle month (UTC).
 * Compounded % within each month matches ∏(1 + pnl/invested) in exit-time order (same as full run when no overlap).
 */

function exitTimestampMs(trade, ohlcv) {
  const t = trade?.exitTime;
  if (t != null) {
    const d = typeof t === 'number' ? (t < 1e10 ? new Date(t * 1000) : new Date(t)) : new Date(t);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  const barIdx = trade?.exitBar;
  if (ohlcv && Number.isFinite(barIdx) && barIdx >= 0 && barIdx < ohlcv.length) {
    const bt = ohlcv[barIdx]?.time;
    if (bt != null) {
      const d = typeof bt === 'number' ? (bt < 1e10 ? new Date(bt * 1000) : new Date(bt)) : new Date(bt);
      if (!Number.isNaN(d.getTime())) return d.getTime();
    }
  }
  return null;
}

function utcMonthKey(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {Array<object>} trades - Backtest trades with pnl, investedAmount, exitTime / exitBar
 * @param {Array<{ time?: string|number|Date }>|null|undefined} ohlcv - Fallback exit dates from candles
 * @returns {Array<{
 *   month: string,
 *   tradesCount: number,
 *   wins: number,
 *   losses: number,
 *   breakeven: number,
 *   winRate: number, // 0–1, wins / tradesCount
 *   totalPnl: number,
 *   totalInvested: number,
 *   blendedPnlPercent: number|null,
 *   compoundedReturnPercent: number|null,
 *   avgTradeProfitPercent: number|null
 * }>}
 */
export function aggregateTradesByExitMonth(trades, ohlcv) {
  if (!Array.isArray(trades) || trades.length === 0) return [];

  const buckets = new Map();
  for (const tr of trades) {
    const ms = exitTimestampMs(tr, ohlcv);
    if (ms == null) continue;
    const month = utcMonthKey(ms);
    if (!buckets.has(month)) buckets.set(month, []);
    buckets.get(month).push({ tr, ms });
  }

  const months = [...buckets.keys()].sort();
  const out = [];

  for (const month of months) {
    const items = buckets.get(month).sort((a, b) => a.ms - b.ms);
    const list = items.map((x) => x.tr);

    let wins = 0;
    let losses = 0;
    let breakeven = 0;
    let totalPnl = 0;
    let totalInvested = 0;
    let factor = 1;
    let hasCompound = false;
    const percents = [];

    for (const t of list) {
      const pnl = Number(t?.pnl);
      const inv = Number(t?.investedAmount);
      if (Number.isFinite(pnl)) totalPnl += pnl;
      if (Number.isFinite(inv) && inv > 0) {
        totalInvested += inv;
        if (Number.isFinite(pnl)) {
          factor *= 1 + pnl / inv;
          hasCompound = true;
        }
      }
      if (Number.isFinite(pnl)) {
        if (pnl > 0) wins += 1;
        else if (pnl < 0) losses += 1;
        else breakeven += 1;
      }
      const pp = t?.profitPercent;
      if (pp != null && Number.isFinite(Number(pp))) percents.push(Number(pp));
    }

    const n = list.length;
    const blendedPnlPercent = totalInvested > 0 ? round2((totalPnl / totalInvested) * 100) : null;
    const compoundedReturnPercent = hasCompound ? round2((factor - 1) * 100) : null;
    const avgTradeProfitPercent =
      percents.length > 0 ? round2(percents.reduce((a, b) => a + b, 0) / percents.length) : null;

    out.push({
      month,
      tradesCount: n,
      wins,
      losses,
      breakeven,
      winRate: n > 0 ? wins / n : 0,
      totalPnl: round2(totalPnl),
      totalInvested: round2(totalInvested),
      blendedPnlPercent,
      compoundedReturnPercent,
      avgTradeProfitPercent,
    });
  }

  return out;
}

export default { aggregateTradesByExitMonth };
