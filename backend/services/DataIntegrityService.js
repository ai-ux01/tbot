/**
 * Data Layer: Validate and sanitize market/strategy data.
 * NEW IMPROVEMENTS: Ensures candles and inputs are valid before strategy/execution.
 */

import { logger } from '../logger.js';

/**
 * DataIntegrityService – Validates OHLC and related inputs.
 */
export class DataIntegrityService {
  /**
   * Validate a single candle has required fields and sane numbers.
   * @param {object} c
   * @returns {{ valid: boolean, candle?: object, error?: string }}
   */
  static validateCandle(c) {
    if (!c || typeof c !== 'object') {
      return { valid: false, error: 'MISSING_CANDLE' };
    }
    const close = c.close;
    if (close == null || !Number.isFinite(close) || close <= 0) {
      return { valid: false, error: 'INVALID_CLOSE' };
    }
    const open = c.open != null ? Number(c.open) : close;
    const high = c.high != null ? Number(c.high) : Math.max(open, close);
    const low = c.low != null ? Number(c.low) : Math.min(open, close);
    const time = c.time != null ? Number(c.time) : Date.now();
    if (!Number.isFinite(time)) {
      return { valid: false, error: 'INVALID_TIME' };
    }
    if (high < low || high < open || high < close || low > open || low > close) {
      return { valid: false, error: 'OHLC_INCONSISTENT' };
    }
    return {
      valid: true,
      candle: { time, open, high, low, close, volume: c.volume != null ? Number(c.volume) : 0 },
    };
  }

  /**
   * Validate and normalize an array of candles. Returns only valid ones; logs invalid.
   * @param {object[]} candles
   * @param {string} [context] - For logging
   * @returns {Array<{ time: number, open: number, high: number, low: number, close: number, volume?: number }>}
   */
  static validateCandles(candles, context = '') {
    if (!Array.isArray(candles)) return [];
    const out = [];
    for (let i = 0; i < candles.length; i++) {
      const r = this.validateCandle(candles[i]);
      if (r.valid && r.candle) out.push(r.candle);
      else if (context) {
        logger.debug('DataIntegrity: invalid candle skipped', {
          context,
          index: i,
          error: r.error,
        });
      }
    }
    return out;
  }
}

export default DataIntegrityService;
