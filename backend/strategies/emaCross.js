import { StrategyState, StrategySignals } from './constants.js';

const EMA_FAST = 9;
const EMA_SLOW = 21;
const MAX_CLOSES = 100;

export const name = 'emaCross';

/**
 * Create an EMA crossover strategy instance (one per symbol/context).
 * @param {Object} [options] - Strategy options (reserved)
 * @returns {{ name: string, onCandle: (candle: object, context: object) => object | null, getState: () => string }}
 */
export function create(options = {}) {
  let state = StrategyState.FLAT;
  const closes = [];
  let ema9 = null;
  let ema21 = null;
  let prevEma9 = null;
  let prevEma21 = null;
  let lastSignal = null;

  function computeEMAs() {
    const n = closes.length;
    if (n < EMA_SLOW) return;
    const k9 = 2 / (EMA_FAST + 1);
    const k21 = 2 / (EMA_SLOW + 1);
    if (ema9 == null) {
      const start9 = Math.max(0, n - EMA_FAST);
      ema9 = sma(closes.slice(start9, start9 + EMA_FAST));
    } else {
      ema9 = closes[n - 1] * k9 + ema9 * (1 - k9);
    }
    if (ema21 == null) {
      const start21 = Math.max(0, n - EMA_SLOW);
      ema21 = sma(closes.slice(start21, start21 + EMA_SLOW));
    } else {
      ema21 = closes[n - 1] * k21 + ema21 * (1 - k21);
    }
  }

  function sma(values) {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function getSignal(candle) {
    if (ema9 == null || ema21 == null) return StrategySignals.HOLD;
    if (prevEma9 == null || prevEma21 == null) return StrategySignals.HOLD;
    const crossUp = prevEma9 <= prevEma21 && ema9 > ema21;
    const crossDown = prevEma9 >= prevEma21 && ema9 < ema21;
    if (crossUp && state === StrategyState.FLAT) {
      state = StrategyState.LONG;
      return StrategySignals.BUY;
    }
    if (crossDown && state === StrategyState.LONG) {
      state = StrategyState.FLAT;
      return StrategySignals.SELL;
    }
    return StrategySignals.HOLD;
  }

  function onCandle(candle, context) {
    const close = candle?.close;
    if (close == null || typeof close !== 'number' || !Number.isFinite(close)) return null;

    closes.push(close);
    if (closes.length > MAX_CLOSES) closes.splice(0, closes.length - MAX_CLOSES);

    prevEma9 = ema9;
    prevEma21 = ema21;
    computeEMAs();

    const signal = getSignal(candle);
    if (signal === StrategySignals.HOLD && lastSignal === StrategySignals.HOLD) return null;
    lastSignal = signal;
    if (signal === StrategySignals.HOLD) return null;

    return {
      signal,
      state,
      candle: { ...candle },
      ema9: ema9 ?? undefined,
      ema21: ema21 ?? undefined,
    };
  }

  function getState() {
    return state;
  }

  return { name, onCandle, getState };
}
