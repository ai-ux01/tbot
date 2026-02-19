/**
 * Natural language explanation from pattern + indicators + last candles.
 * Template-based; can be extended with LLM when API key is set.
 */

/**
 * Build human-readable explanation from inputs.
 */
export async function buildExplanation(opts) {
  const pattern = opts.pattern || {};
  const indicators = opts.indicators || {};
  const lastCandles = opts.lastCandles || [];
  const instrument = opts.instrument || '';

  const parts = [];
  const lastClose = lastCandles.length ? Number(lastCandles[lastCandles.length - 1]?.close) : null;
  const aboveEma50 = lastClose != null && indicators.ema50 != null ? lastClose > indicators.ema50 : null;
  if (aboveEma50 !== null) {
    const msg = aboveEma50
      ? `Price is trading above EMA50 (${indicators.ema50.toFixed(2)})`
      : `Price is trading below EMA50 (${indicators.ema50.toFixed(2)})`;
    parts.push(msg);
  }
  if (indicators.rsi != null) {
    const rsiDesc = indicators.rsi < 30 ? 'oversold' : indicators.rsi > 70 ? 'overbought' : 'neutral';
    parts.push(`RSI at ${indicators.rsi.toFixed(0)} indicating ${rsiDesc} momentum`);
  }
  if (pattern.pattern && typeof pattern.probability === 'number') {
    const pct = Math.round(pattern.probability * 100);
    parts.push(`AI detected ${pattern.pattern} pattern with ${pct}% confidence`);
  }
  if (pattern.trend_prediction) {
    parts.push(`Trend prediction: ${pattern.trend_prediction}`);
  }
  if (instrument) {
    parts.unshift(`[${instrument}]`);
  }

  return parts.length ? parts.join('. ') : 'No explanation available.';
}

export default { buildExplanation };
