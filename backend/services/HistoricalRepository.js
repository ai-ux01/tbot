/**
 * Data Layer: Historical OHLC. Fetches from broker API and optionally caches to DB.
 * NEW IMPROVEMENTS: Single source for historical data; backtest uses DB when available.
 */

import * as kotakApi from './kotakApi.js';
import { isDbConnected } from '../database/connection.js';
import { Candle } from '../database/models/Candle.js';
import { logger } from '../logger.js';

const LOOKBACK_MONTHS_DEFAULT = 12;

/**
 * Normalize candle to { time, open, high, low, close, volume }.
 * @param {object} c
 * @returns {{ time: Date, open: number, high: number, low: number, close: number, volume?: number }}
 */
function normalizeCandle(c) {
  if (!c || typeof c.close !== 'number' && c.close == null) return null;
  const time = c.time != null ? new Date(c.time) : new Date();
  return {
    time: time instanceof Date ? time : new Date(time),
    open: Number(c.open ?? c.close),
    high: Number(c.high ?? c.close),
    low: Number(c.low ?? c.close),
    close: Number(c.close),
    volume: c.volume != null ? Number(c.volume) : 0,
  };
}

/**
 * HistoricalRepository – Data layer for OHLC.
 * Does not call broker when using DB-only path (for backtest).
 */
export class HistoricalRepository {
  /**
   * Fetch historical candles from broker. Optionally persist to DB for future backtest.
   * @param {{ baseUrl: string, auth: string, sid: string }} session
   * @param {string} instrumentToken
   * @param {'day'|'week'|'month'} interval
   * @param {{ lookbackMonths?: number, symbol?: string, persist?: boolean }} [opts]
   * @returns {Promise<Array<{ time: number, open: number, high: number, low: number, close: number, volume?: number }>>}
   */
  static async getHistorical(session, instrumentToken, interval, opts = {}) {
    const { lookbackMonths = LOOKBACK_MONTHS_DEFAULT, symbol, persist = false } = opts;
    const raw = await kotakApi.getHistorical(session.baseUrl, session.auth, session.sid, {
      instrumentToken,
      interval,
      lookbackMonths,
    });
    const candles = (raw || [])
      .map((c) => {
        const norm = normalizeCandle(
          c.time != null && c.close != null
            ? c
            : Array.isArray(c) ? { time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] } : null
        );
        return norm ? { ...norm, time: norm.time.getTime ? norm.time.getTime() : Number(norm.time) } : null;
      })
      .filter(Boolean);

    if (persist && isDbConnected() && symbol) {
      await this._persistCandles(symbol, interval, candles).catch((err) => {
        logger.warn('HistoricalRepository persist failed', { symbol, interval, error: err?.message });
      });
    }
    return candles;
  }

  /**
   * Read historical candles from DB only (no broker). For backtest.
   * @param {string} symbolOrToken - Symbol or instrumentToken stored as symbol
   * @param {string} timeframe - 'day' | 'week' | 'month'
   * @param {Date} from
   * @param {Date} to
   * @returns {Promise<Array<{ time: number, open: number, high: number, low: number, close: number, volume?: number }>>}
   */
  static async getHistoricalFromDb(symbolOrToken, timeframe, from, to) {
    if (!isDbConnected()) return [];
    const docs = await Candle.find({
      symbol: String(symbolOrToken),
      timeframe: String(timeframe),
      time: { $gte: from, $lte: to },
    })
      .sort({ time: 1 })
      .lean();
    return docs.map((d) => ({
      time: d.time instanceof Date ? d.time.getTime() : Number(d.time),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume ?? 0,
    }));
  }

  /**
   * Bulk upsert candles. Uses bulkWrite for performance.
   * Time is stored in UTC (MongoDB Date).
   * @param {string} symbol
   * @param {string} timeframe
   * @param {Array<{ time: number | Date, open: number, high: number, low: number, close: number, volume?: number }>} candles
   */
  static async _persistCandles(symbol, timeframe, candles) {
    if (!isDbConnected() || !candles.length) return;
    const ops = candles.map((c) => {
      const time = c.time instanceof Date ? c.time : new Date(c.time); // UTC
      return {
        updateOne: {
          filter: { symbol, timeframe, time },
          update: {
            $set: {
              symbol,
              timeframe,
              time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume ?? 0,
            },
          },
          upsert: true,
        },
      };
    });
    const batchSize = 500;
    for (let i = 0; i < ops.length; i += batchSize) {
      const batch = ops.slice(i, i + batchSize);
      await Candle.bulkWrite(batch);
    }
  }
}

export default HistoricalRepository;
