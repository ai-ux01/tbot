/**
 * EMA 10 / EMA 20 crossover (mirrors backend for live WebSocket use).
 * BUY when EMA10 crosses above EMA20; SELL when EMA10 crosses below EMA20.
 */

const EMA_FAST = 10;
const EMA_SLOW = 20;

function sma(arr, period) {
  if (!Array.isArray(arr) || arr.length < period) return null;
  const slice = arr.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function emaSeries(data, period) {
  if (!Array.isArray(data) || data.length < period) return [];
  const k = 2 / (period + 1);
  let ema = sma(data.slice(0, period), period);
  const out = Array(period - 1).fill(null);
  out.push(ema);
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

/**
 * @param {number[]} closes - Close prices (oldest first)
 * @returns {{ signal: 'BUY'|'SELL'|'HOLD', entryPrice: number|null, explanation: string }}
 */
export function evaluate(closes) {
  const empty = { signal: 'HOLD', entryPrice: null, explanation: 'Insufficient data.' };
  if (!Array.isArray(closes) || closes.length < EMA_SLOW + 1) return empty;

  const ema10 = emaSeries(closes, EMA_FAST);
  const ema20 = emaSeries(closes, EMA_SLOW);
  const i = closes.length - 1;
  const prev = i - 1;

  const e10 = ema10[i];
  const e20 = ema20[i];
  const e10Prev = ema10[prev];
  const e20Prev = ema20[prev];

  if (!Number.isFinite(e10) || !Number.isFinite(e20) || !Number.isFinite(e10Prev) || !Number.isFinite(e20Prev)) {
    return { ...empty, explanation: 'EMA not yet warm.' };
  }

  const close = closes[i];
  const crossUp = e10Prev <= e20Prev && e10 > e20;
  const crossDown = e10Prev >= e20Prev && e10 < e20;

  if (crossUp) {
    return {
      signal: 'BUY',
      entryPrice: close,
      explanation: `EMA 10 crossed above EMA 20. Close ${close?.toFixed(2)}, EMA10 ${e10?.toFixed(2)}, EMA20 ${e20?.toFixed(2)}.`,
    };
  }
  if (crossDown) {
    return {
      signal: 'SELL',
      entryPrice: close,
      explanation: `EMA 10 crossed below EMA 20. Close ${close?.toFixed(2)}, EMA10 ${e10?.toFixed(2)}, EMA20 ${e20?.toFixed(2)}.`,
    };
  }
  const trend = e10 > e20 ? 'bullish' : 'bearish';
  return {
    signal: 'HOLD',
    entryPrice: null,
    explanation: `No crossover. EMA10 ${e10?.toFixed(2)}, EMA20 ${e20?.toFixed(2)} (${trend}).`,
  };
}
