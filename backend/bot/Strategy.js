import { EventEmitter } from 'events';

const EMA_FAST = 9;
const EMA_SLOW = 21;
const MAX_CLOSES = 100;

/** Strategy position state */
export const StrategyState = Object.freeze({
  FLAT: 'FLAT',
  LONG: 'LONG',
});

/** Strategy signal names */
export const StrategySignals = Object.freeze({
  BUY: 'BUY',
  SELL: 'SELL',
  HOLD: 'HOLD',
});

/** Strategy event names */
export const StrategyEvents = Object.freeze({
  SIGNAL: 'signal',
});

/**
 * EMA crossover strategy: EMA 9 & EMA 21 on candle closes.
 * State: FLAT | LONG. Emits BUY, SELL, HOLD. No duplicate consecutive signals.
 * Pure signal logic; no order placement.
 */
export class Strategy extends EventEmitter {
  constructor() {
    super();
    /** @type {StrategyState} */
    this._state = StrategyState.FLAT;
    /** @type {number[]} */
    this._closes = [];
    /** @type {number | null} */
    this._ema9 = null;
    /** @type {number | null} */
    this._ema21 = null;
    /** @type {number | null} */
    this._prevEma9 = null;
    /** @type {number | null} */
    this._prevEma21 = null;
    /** @type {StrategySignals | null} - last emitted signal to avoid duplicates */
    this._lastSignal = null;
  }

  /**
   * Feed a completed candle. Computes EMAs and may emit a signal.
   * @param {{ time: number, open: number, high: number, low: number, close: number }} candle
   */
  addCandle(candle) {
    const close = candle?.close;
    if (close == null || typeof close !== 'number' || !Number.isFinite(close)) return;

    this._closes.push(close);
    if (this._closes.length > MAX_CLOSES) {
      this._closes = this._closes.slice(-MAX_CLOSES);
    }

    this._prevEma9 = this._ema9;
    this._prevEma21 = this._ema21;
    this._computeEMAs();

    const signal = this._getSignal(candle);
    const duplicateHold = signal === StrategySignals.HOLD && this._lastSignal === StrategySignals.HOLD;
    if (signal != null && !duplicateHold) {
      this._lastSignal = signal;
      this.emit(StrategyEvents.SIGNAL, {
        signal,
        state: this._state,
        candle: { ...candle },
        ema9: this._ema9 ?? undefined,
        ema21: this._ema21 ?? undefined,
      });
    }
  }

  /** Current position state (FLAT | LONG). */
  getState() {
    return this._state;
  }

  /** Last emitted signal (BUY | SELL | HOLD), or null. */
  getLastSignal() {
    return this._lastSignal;
  }

  /** Latest EMA 9 value, or null if not yet computed. */
  getEma9() {
    return this._ema9;
  }

  /** Latest EMA 21 value, or null if not yet computed. */
  getEma21() {
    return this._ema21;
  }

  /**
   * True if EMA9 > EMA21 (bullish trend). Requires at least 21 candles for warmup.
   * Used by Scanner; does not affect live signal behavior.
   */
  isBullish() {
    if (this._ema9 == null || this._ema21 == null) return false;
    return this._ema9 > this._ema21;
  }

  /**
   * Detect fresh crossover on the last candle only. No signal until 21 candles minimum.
   * Used by Swing bot for daily entry/exit. Does not change internal state.
   * @returns {'BUY'|'SELL'|null} BUY = prev EMA9 < EMA21 and current EMA9 > EMA21; SELL = opposite.
   */
  detectFreshCrossover() {
    if (this._closes.length < 21) return null;
    if (this._ema9 == null || this._ema21 == null || this._prevEma9 == null || this._prevEma21 == null) return null;
    if (this._prevEma9 < this._prevEma21 && this._ema9 > this._ema21) return StrategySignals.BUY;
    if (this._prevEma9 > this._prevEma21 && this._ema9 < this._ema21) return StrategySignals.SELL;
    return null;
  }

  _computeEMAs() {
    const n = this._closes.length;
    if (n < EMA_SLOW) return;

    const k9 = 2 / (EMA_FAST + 1);
    const k21 = 2 / (EMA_SLOW + 1);

    if (this._ema9 == null) {
      const start9 = Math.max(0, n - EMA_FAST);
      this._ema9 = this._sma(this._closes.slice(start9, start9 + EMA_FAST));
    } else {
      this._ema9 = this._closes[n - 1] * k9 + this._ema9 * (1 - k9);
    }

    if (this._ema21 == null) {
      const start21 = Math.max(0, n - EMA_SLOW);
      this._ema21 = this._sma(this._closes.slice(start21, start21 + EMA_SLOW));
    } else {
      this._ema21 = this._closes[n - 1] * k21 + this._ema21 * (1 - k21);
    }
  }

  _sma(values) {
    if (values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
  }

  /**
   * Determine signal from EMA cross and state. Prevents duplicates.
   * @returns {StrategySignals | null}
   */
  _getSignal(candle) {
    if (this._ema9 == null || this._ema21 == null) return StrategySignals.HOLD;
    if (this._prevEma9 == null || this._prevEma21 == null) return StrategySignals.HOLD;

    const crossUp = this._prevEma9 <= this._prevEma21 && this._ema9 > this._ema21;
    const crossDown = this._prevEma9 >= this._prevEma21 && this._ema9 < this._ema21;

    if (crossUp && this._state === StrategyState.FLAT) {
      this._state = StrategyState.LONG;
      return StrategySignals.BUY;
    }
    if (crossDown && this._state === StrategyState.LONG) {
      this._state = StrategyState.FLAT;
      return StrategySignals.SELL;
    }

    return StrategySignals.HOLD;
  }
}
