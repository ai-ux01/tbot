import { EventEmitter } from 'events';

const CANDLE_INTERVAL_SEC = 60;
const MAX_CANDLES = 500;

/** CandleBuilder event names */
export const CandleBuilderEvents = Object.freeze({
  CANDLE: 'candle',
});

/**
 * Builds 1-minute OHLC candles from ticks.
 * Maintains current forming candle, emits completed candle every 60 seconds (aligned to minute boundary).
 * Keeps at most MAX_CANDLES completed candles in memory.
 */
export class CandleBuilder extends EventEmitter {
  constructor() {
    super();
    /** @type {Array<{ time: number, open: number, high: number, low: number, close: number }>} */
    this._candles = [];
    /** @type {{ time: number, open: number, high: number, low: number, close: number } | null} */
    this._current = null;
    this._intervalId = null;
    this._alignTimeoutId = null;
  }

  /**
   * Start the 60-second timer (aligned to wall-clock minute). Idempotent.
   */
  start() {
    if (this._intervalId != null) return;
    const tick = () => {
      this._onMinuteBoundary();
      this._intervalId = setInterval(tick, CANDLE_INTERVAL_SEC * 1000);
    };
    const now = Date.now();
    const sec = Math.floor(now / 1000);
    const nextMinuteSec = (Math.floor(sec / CANDLE_INTERVAL_SEC) + 1) * CANDLE_INTERVAL_SEC;
    const alignMs = Math.max(0, nextMinuteSec * 1000 - now);
    this._alignTimeoutId = setTimeout(tick, alignMs);
  }

  /**
   * Stop the timer. Does not clear candles.
   */
  stop() {
    if (this._alignTimeoutId != null) {
      clearTimeout(this._alignTimeoutId);
      this._alignTimeoutId = null;
    }
    if (this._intervalId != null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  /**
   * Add a tick. Updates current forming candle or starts a new one.
   * Price is taken from tick.ltp (or tick.close); tick.time is used for bucket (fallback: now).
   * @param {{ instrumentToken?: string, ltp?: number, close?: number, time?: number }} tick
   */
  addTick(tick) {
    const price = tick?.ltp ?? tick?.close;
    if (price == null || typeof price !== 'number' || !Number.isFinite(price)) return;

    const t = tick?.time != null && Number.isFinite(tick.time)
      ? Math.floor(Number(tick.time))
      : Math.floor(Date.now() / 1000);
    const bucket = Math.floor(t / CANDLE_INTERVAL_SEC) * CANDLE_INTERVAL_SEC;

    if (this._current != null && this._current.time !== bucket) {
      this._pushAndEmit(this._current);
      this._current = null;
    }

    if (this._current == null) {
      this._current = {
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
      };
      return;
    }

    this._current.high = Math.max(this._current.high, price);
    this._current.low = Math.min(this._current.low, price);
    this._current.close = price;
  }

  /**
   * Get a copy of completed candles (oldest first). Max length 500.
   * @returns {Array<{ time: number, open: number, high: number, low: number, close: number }>}
   */
  getCandles() {
    return [...this._candles];
  }

  /**
   * Get the current forming candle, if any.
   * @returns {{ time: number, open: number, high: number, low: number, close: number } | null}
   */
  getCurrentCandle() {
    return this._current == null ? null : { ...this._current };
  }

  _pushAndEmit(candle) {
    this._candles.push(candle);
    if (this._candles.length > MAX_CANDLES) {
      this._candles = this._candles.slice(-MAX_CANDLES);
    }
    this.emit(CandleBuilderEvents.CANDLE, candle);
  }

  _onMinuteBoundary() {
    if (this._current == null) return;
    this._pushAndEmit(this._current);
    this._current = null;
  }
}
