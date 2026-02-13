import { StrategyState, StrategySignals } from './constants.js';

const DEFAULT_LOOKBACK = 20;
const MAX_CANDLES = 200;

export const name = 'breakout';

/**
 * Create a breakout strategy instance (one per symbol/context).
 * @param {Object} [options] - { lookback: number }
 * @returns {{ name: string, onCandle: (candle: object, context: object) => object | null, getState: () => string }}
 */
export function create(options = {}) {
  const lookback = options.lookback ?? DEFAULT_LOOKBACK;
  let state = StrategyState.FLAT;
  const candles = [];
  let lastSignal = null;

  function onCandle(candle, context) {
    const c = candle?.close;
    const h = candle?.high;
    const l = candle?.low;
    if (c == null || h == null || l == null || !Number.isFinite(c)) return null;

    candles.push({ ...candle, open: candle.open, high: h, low: l, close: c });
    if (candles.length > MAX_CANDLES) candles.splice(0, candles.length - MAX_CANDLES);

    const n = candles.length;
    if (n < lookback + 1) return null;

    const recent = candles.slice(-lookback - 1, -1);
    const highN = Math.max(...recent.map((x) => x.high));
    const lowN = Math.min(...recent.map((x) => x.low));
    const prevClose = candles[candles.length - 2]?.close;

    let signal = StrategySignals.HOLD;
    if (c > highN && prevClose <= highN && state === StrategyState.FLAT) {
      state = StrategyState.LONG;
      signal = StrategySignals.BUY;
    } else if (c < lowN && prevClose >= lowN && state === StrategyState.LONG) {
      state = StrategyState.FLAT;
      signal = StrategySignals.SELL;
    }

    if (signal === StrategySignals.HOLD && lastSignal === StrategySignals.HOLD) return null;
    lastSignal = signal;
    if (signal === StrategySignals.HOLD) return null;

    return { signal, state, candle: { ...candle }, highN, lowN };
  }

  function getState() {
    return state;
  }

  return { name, onCandle, getState };
}
