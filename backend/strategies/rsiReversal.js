import { StrategyState, StrategySignals } from './constants.js';

const RSI_PERIOD = 14;
const RSI_OVERSOLD = 30;
const RSI_OVERBOUGHT = 70;
const MAX_CLOSES = 200;

export const name = 'rsiReversal';

/**
 * Create an RSI reversal strategy instance (one per symbol/context).
 * @param {Object} [options] - { period, oversold, overbought }
 * @returns {{ name: string, onCandle: (candle: object, context: object) => object | null, getState: () => string }}
 */
export function create(options = {}) {
  const period = options.period ?? RSI_PERIOD;
  const oversold = options.oversold ?? RSI_OVERSOLD;
  const overbought = options.overbought ?? RSI_OVERBOUGHT;
  let state = StrategyState.FLAT;
  const closes = [];
  let rsi = null;
  let prevRsi = null;
  let lastSignal = null;

  function computeRSI() {
    const n = closes.length;
    if (n < period + 1) return null;
    const changes = [];
    for (let i = n - period; i < n; i++) {
      changes.push(closes[i] - closes[i - 1]);
    }
    const gains = changes.filter((c) => c > 0);
    const losses = changes.filter((c) => c < 0).map((c) => Math.abs(c));
    const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / period : 0;
    const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / period : 0;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  function onCandle(candle, context) {
    const close = candle?.close;
    if (close == null || typeof close !== 'number' || !Number.isFinite(close)) return null;

    closes.push(close);
    if (closes.length > MAX_CLOSES) closes.splice(0, closes.length - MAX_CLOSES);

    prevRsi = rsi;
    rsi = computeRSI();
    if (rsi == null) return null;

    let signal = StrategySignals.HOLD;
    if (prevRsi != null) {
      if (prevRsi < oversold && rsi >= oversold && state === StrategyState.FLAT) {
        state = StrategyState.LONG;
        signal = StrategySignals.BUY;
      } else if (prevRsi > overbought && rsi <= overbought && state === StrategyState.LONG) {
        state = StrategyState.FLAT;
        signal = StrategySignals.SELL;
      }
    }

    if (signal === StrategySignals.HOLD && lastSignal === StrategySignals.HOLD) return null;
    lastSignal = signal;
    if (signal === StrategySignals.HOLD) return null;

    return { signal, state, candle: { ...candle }, rsi };
  }

  function getState() {
    return state;
  }

  return { name, onCandle, getState };
}
