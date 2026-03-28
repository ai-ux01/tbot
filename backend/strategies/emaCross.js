import { StrategyState, StrategySignals } from './constants.js';

const DEFAULT_FAST = 9;
const DEFAULT_SLOW = 21;
const MAX_CLOSES = 500;

export const name = 'emaCross';

/**
 * Create an EMA crossover strategy instance (one per symbol/context).
 * @param {Object} [options] - { fast: number, slow: number, filterSlow: number } (default 9, 21; use 10, 20, 50 for 10/20 cross with EMA 20 > EMA 50)
 *   When filterSlow (e.g. 50) is set, BUY only when fast crosses above slow AND slow EMA is above filter EMA.
 * @returns {{ name: string, onCandle: (candle: object, context: object) => object | null, getState: () => string }}
 */
export function create(options = {}) {
  const fast = Math.max(2, parseInt(options.fast, 10) || DEFAULT_FAST);
  const slow = Math.max(fast + 1, parseInt(options.slow, 10) || DEFAULT_SLOW);
  const filterSlow = Math.max(slow + 1, parseInt(options.filterSlow ?? options.ema50, 10) || 0);

  let state = StrategyState.FLAT;
  const closes = [];
  let emaFast = null;
  let emaSlow = null;
  let emaFilter = null;
  let prevEmaFast = null;
  let prevEmaSlow = null;
  let lastSignal = null;

  function computeEMAs() {
    const n = closes.length;
    if (n < slow) return;
    const kFast = 2 / (fast + 1);
    const kSlow = 2 / (slow + 1);
    if (emaFast == null) {
      const startF = Math.max(0, n - fast);
      emaFast = sma(closes.slice(startF, startF + fast));
    } else {
      emaFast = closes[n - 1] * kFast + emaFast * (1 - kFast);
    }
    if (emaSlow == null) {
      const startS = Math.max(0, n - slow);
      emaSlow = sma(closes.slice(startS, startS + slow));
    } else {
      emaSlow = closes[n - 1] * kSlow + emaSlow * (1 - kSlow);
    }
    if (filterSlow > 0) {
      if (n < filterSlow) return;
      const kFilter = 2 / (filterSlow + 1);
      if (emaFilter == null) {
        const startF = Math.max(0, n - filterSlow);
        emaFilter = sma(closes.slice(startF, startF + filterSlow));
      } else {
        emaFilter = closes[n - 1] * kFilter + emaFilter * (1 - kFilter);
      }
    }
  }

  function sma(values) {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function getSignal(candle) {
    if (emaFast == null || emaSlow == null) return StrategySignals.HOLD;
    if (prevEmaFast == null || prevEmaSlow == null) return StrategySignals.HOLD;
    const crossUp = prevEmaFast <= prevEmaSlow && emaFast > emaSlow;
    const crossDown = prevEmaFast >= prevEmaSlow && emaFast < emaSlow;
    const ema20Above50 = filterSlow <= 0 || (emaFilter != null && emaSlow > emaFilter);
    if (crossUp && state === StrategyState.FLAT && ema20Above50) {
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

    prevEmaFast = emaFast;
    prevEmaSlow = emaSlow;
    computeEMAs();

    const signal = getSignal(candle);
    if (signal === StrategySignals.HOLD && lastSignal === StrategySignals.HOLD) return null;
    lastSignal = signal;
    if (signal === StrategySignals.HOLD) return null;

    return {
      signal,
      state,
      candle: { ...candle },
      emaFast: emaFast ?? undefined,
      emaSlow: emaSlow ?? undefined,
      emaFilter: emaFilter ?? undefined,
    };
  }

  function getState() {
    return state;
  }

  return { name, onCandle, getState };
}

/** Strategy options for 1D backtest: EMA 10/20 cross, BUY only when EMA 20 > EMA 50 */
export const options1D = { fast: 10, slow: 20, filterSlow: 50 };
