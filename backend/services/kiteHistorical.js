/**
 * Zerodha Kite Connect – fetch historical candle data.
 * Endpoint: GET /instruments/historical/:instrument_token/:interval
 * Auth: Authorization: token api_key:access_token (e.g. curl -H "Authorization: token xxx:yyy"), X-Kite-Version: 3
 */

import axios from 'axios';
import { logger } from '../logger.js';

const KITE_BASE = 'https://api.kite.trade';

/** Allowed interval values for Kite historical API */
const VALID_INTERVALS = [
  'minute',
  '3minute',
  '5minute',
  '10minute',
  '15minute',
  '30minute',
  '60minute',
  'day',
];

/**
 * Parse Kite timestamp (number ms or ISO string like "2017-12-15T09:15:00+0530") to ms.
 */
function parseTimestamp(ts) {
  if (ts == null) return NaN;
  const n = Number(ts);
  if (!Number.isNaN(n) && n > 0) return n;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? NaN : d.getTime();
}

/**
 * Normalize Kite candle array to object. Kite returns [timestamp, open, high, low, close, volume] or with oi.
 * Timestamp may be number (ms) or ISO string (e.g. "2017-12-15T09:15:00+0530").
 * @param {Array<number|string>} row - [timestamp, open, high, low, close, volume, oi?]
 * @param {boolean} includeOi
 * @returns {{ timestamp: number, open: number, high: number, low: number, close: number, volume: number, oi?: number }}
 */
function candleFromRow(row, includeOi) {
  const [timestamp, open, high, low, close, volume, oi] = row ?? [];
  const ts = parseTimestamp(timestamp);
  const candle = {
    timestamp: ts,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume) || 0,
  };
  if (includeOi && oi !== undefined) candle.oi = Number(oi);
  return candle;
}

/**
 * Fetch historical candles from Kite Connect.
 *
 * @param {Object} params
 * @param {string} params.apiKey - Kite API key
 * @param {string} params.accessToken - Kite access token (from session)
 * @param {string|number} params.instrumentToken - Instrument token (e.g. 5633 or '5633')
 * @param {string} params.interval - minute | 3minute | 5minute | 10minute | 15minute | 30minute | 60minute | day
 * @param {string} params.from - Start datetime 'yyyy-mm-dd hh:mm:ss'
 * @param {string} params.to - End datetime 'yyyy-mm-dd hh:mm:ss'
 * @param {Object} [params.options]
 * @param {0|1} [params.options.continuous] - 1 for continuous futures (NFO/MCX expired contracts), default 0
 * @param {0|1} [params.options.oi] - 1 to include open interest in candles, default 0
 * @returns {Promise<Array<{ timestamp: number, open: number, high: number, low: number, close: number, volume: number, oi?: number }>>}
 */
export async function getHistoricalCandles(params) {
  const {
    apiKey,
    accessToken,
    instrumentToken,
    interval,
    from,
    to,
    options = {},
  } = params;

  if (!apiKey || !accessToken) {
    logger.warn('kiteHistorical', { msg: 'Missing apiKey or accessToken' });
    throw new Error('apiKey and accessToken are required');
  }

  const token = String(instrumentToken ?? '').trim();
  if (!token) {
    throw new Error('instrumentToken is required');
  }

  const intervalLower = String(interval ?? '').toLowerCase();
  if (!VALID_INTERVALS.includes(intervalLower)) {
    throw new Error(
      `Invalid interval. Use one of: ${VALID_INTERVALS.join(', ')}`
    );
  }

  if (!from || !to) {
    throw new Error('from and to (yyyy-mm-dd hh:mm:ss) are required');
  }

  const continuous = options.continuous === 1 ? 1 : 0;
  const oi = options.oi === 1 ? 1 : 0;

  const path = `/instruments/historical/${encodeURIComponent(token)}/${intervalLower}`;
  const query = new URLSearchParams({
    from: from,
    to: to,
    continuous: String(continuous),
    oi: String(oi),
  });
  const url = `${KITE_BASE}${path}?${query.toString()}`;

  logger.info('kiteHistorical', {
    msg: 'Fetching historical candles',
    instrumentToken: token,
    interval: intervalLower,
    from,
    to,
    continuous,
    oi,
  });

  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: `token ${apiKey}:${accessToken}`,
        'X-Kite-Version': '3',
      },
      timeout: 30000,
    });

    const data = res.data;
    const rawCandles = data?.data?.candles ?? data?.candles ?? [];
    if (!Array.isArray(rawCandles)) {
      logger.warn('kiteHistorical', { msg: 'Unexpected response shape', hasData: !!data });
      return [];
    }

    const candles = rawCandles.map((row) => candleFromRow(row, oi === 1));
    logger.info('kiteHistorical', {
      msg: 'Historical candles fetched',
      instrumentToken: token,
      count: candles.length,
    });
    return candles;
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.message ?? err.response?.data?.error ?? err.message;
    logger.error('kiteHistorical', {
      msg: 'Historical fetch failed',
      instrumentToken: token,
      status,
      error: message,
    });
    if (status === 401) {
      throw new Error('Kite session expired or invalid');
    }
    if (status === 403) {
      throw new Error('Kite access denied');
    }
    throw new Error(message || 'Failed to fetch historical candles');
  }
}

/**
 * Example usage:
 *
 * // Regular candles (no OI)
 * const candles = await getHistoricalCandles({
 *   apiKey: process.env.KITE_API_KEY,
 *   accessToken: session.accessToken,
 *   instrumentToken: '5633',
 *   interval: 'minute',
 *   from: '2024-01-15 09:15:00',
 *   to: '2024-01-15 15:30:00',
 *   options: { continuous: 0, oi: 0 },
 * });
 *
 * // With open interest (e.g. for F&O)
 * const candlesWithOi = await getHistoricalCandles({
 *   apiKey,
 *   accessToken,
 *   instrumentToken: '12345',
 *   interval: '5minute',
 *   from: '2024-01-01 09:15:00',
 *   to: '2024-01-10 15:30:00',
 *   options: { continuous: 0, oi: 1 },
 * });
 *
 * // Continuous futures (expired NFO/MCX contracts)
 * const continuousCandles = await getHistoricalCandles({
 *   apiKey,
 *   accessToken,
 *   instrumentToken: '67890',
 *   interval: 'day',
 *   from: '2023-06-01 00:00:00',
 *   to: '2023-06-30 00:00:00',
 *   options: { continuous: 1, oi: 1 },
 * });
 */
