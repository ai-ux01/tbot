/**
 * FailureDetector: Post-entry monitoring for RSI Setup trades.
 * Conditions: RSI < 35, close < EMA50, stop hit, bearish engulfing.
 */

/**
 * Check failure conditions on post-entry candles.
 * @param {{
 *   candles: Array<{ open, high, low, close }>,
 *   rsi: number[],
 *   ema50: number[],
 *   entryIndex: number,
 *   entryPrice: number,
 *   stopLoss: number
 * }} ctx - Candles and indicators; candles/rsi/ema50 aligned by index
 * @returns {{ failureDetected: boolean, failureReason: string }}
 */
export function checkFailure(ctx) {
  const { candles, rsi, ema50, entryIndex, entryPrice, stopLoss } = ctx;
  if (!candles || !Array.isArray(candles) || entryIndex < 0 || entryIndex >= candles.length) {
    return { failureDetected: false, failureReason: '' };
  }

  for (let i = entryIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    const r = rsi?.[i];
    const e50 = ema50?.[i];

    if (c == null) continue;

    // RSI drops below 35
    if (r != null && Number.isFinite(r) && r < 35) {
      return { failureDetected: true, failureReason: `RSI dropped below 35 (${r.toFixed(1)})` };
    }

    // Price closes below EMA50
    if (c.close != null && e50 != null && Number.isFinite(c.close) && Number.isFinite(e50) && c.close < e50) {
      return { failureDetected: true, failureReason: 'Price closed below EMA50' };
    }

    // Price hits StopLoss (low touches or goes below)
    if (stopLoss != null && c.low != null && Number.isFinite(c.low) && c.low <= stopLoss) {
      return { failureDetected: true, failureReason: 'Stop loss hit' };
    }

    // Bearish engulfing: open > prev.close, close < prev.open, close < open
    if (i > 0) {
      const prev = candles[i - 1];
      if (
        prev &&
        prev.open != null &&
        prev.close != null &&
        c.open != null &&
        c.close != null &&
        c.open > prev.close &&
        c.close < prev.open &&
        c.close < c.open
      ) {
        return { failureDetected: true, failureReason: 'Bearish engulfing pattern after entry' };
      }
    }
  }

  return { failureDetected: false, failureReason: '' };
}

export default { checkFailure };
