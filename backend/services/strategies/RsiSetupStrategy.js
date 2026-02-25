/**
 * RSI Setup strategy: BUY on RSI momentum reset in uptrend.
 * Peak ≥70 → pullback 35-45 → rebound 55-65 → second pullback near low1 → RSI turning up.
 * Requires: close[], rsi[], ema20[], ema50[], volume[], avgVolume[] (arrays).
 * @returns {{ signal_type: 'BUY'|'HOLD', confidence?: number, reason?: string, structure?: object }}
 */
export function rsiSwingBuyStrategy(data) {
  const { rsi: rsiArr, ema20, ema50, close, volume, avgVolume } = data;
  const len = rsiArr?.length ?? 0;
  if (len < 50) return { signal_type: 'HOLD' };

  const rsi = rsiArr;
  const last = len - 1;
  const prev = len - 2;

  if (
    close[last] == null ||
    ema20[last] == null ||
    ema50[last] == null ||
    rsi[last] == null ||
    rsi[prev] == null
  ) {
    return { signal_type: 'HOLD' };
  }

  const uptrend = close[last] > ema50[last] && ema20[last] > ema50[last];
  if (!uptrend) return { signal_type: 'HOLD' };

  const peak1 = rsi.findIndex((v) => v != null && v >= 70);
  if (peak1 === -1) return { signal_type: 'HOLD' };

  const low1 = rsi.slice(peak1).findIndex((v) => v != null && v >= 35 && v <= 45);
  if (low1 === -1) return { signal_type: 'HOLD' };

  const absLow1 = peak1 + low1;
  const low1Val = rsi[absLow1];

  const peak2 = rsi.slice(absLow1).findIndex((v) => v != null && v >= 55 && v <= 65);
  if (peak2 === -1) return { signal_type: 'HOLD' };

  const absPeak2 = absLow1 + peak2;

  const low2 = rsi.slice(absPeak2).findIndex((v) => v != null && Math.abs(v - low1Val) <= 5);
  if (low2 === -1) return { signal_type: 'HOLD' };

  const absLow2 = absPeak2 + low2;

  const rsiTurnUp = rsi[last] > rsi[prev];

  const volLast = volume[last] ?? 0;
  const avgVolLast = avgVolume[last] ?? 0;
  const volumeConfirm = avgVolLast > 0 && volLast > avgVolLast;

  if (last > absLow2 && rsiTurnUp) {
    const p1 = rsi[peak1]?.toFixed(1) ?? '—';
    const l1 = low1Val?.toFixed(1) ?? '—';
    const p2 = rsi[absPeak2]?.toFixed(1) ?? '—';
    const l2 = rsi[absLow2]?.toFixed(1) ?? '—';
    const explanation = [
      'BUY: RSI momentum reset in uptrend.',
      `Structure: RSI peaked at ${p1}, pulled back to ${l1}, rebounded to ${p2}, second pullback to ${l2}, now turning up.`,
      volumeConfirm ? 'Volume above average confirms strength.' : 'Volume confirmation not met.',
    ].join(' ');
    return {
      signal_type: 'BUY',
      confidence: volumeConfirm ? 0.85 : 0.75,
      reason: 'RSI momentum reset in uptrend',
      explanation,
      structure: {
        peak1: rsi[peak1],
        low1: low1Val,
        peak2: rsi[absPeak2],
        low2: rsi[absLow2],
      },
    };
  }

  return { signal_type: 'HOLD' };
}
