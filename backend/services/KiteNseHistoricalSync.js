/**
 * Sync NSE equity historical data (1h + 1 day) for last 5 years to DB.
 * Uses Kite instruments (NSE, EQ only) and getHistoricalCandles; persists to Candle collection.
 * Incremental: if yesterday's data exists for an instrument, only fetches/stores today; else full sync.
 */

import { getInstruments } from './kiteApi.js';
import { getHistoricalCandles } from './kiteHistorical.js';
import { Candle } from '../database/models/Candle.js';
import { isDbConnected } from '../database/connection.js';
import { logger } from '../logger.js';

const DELAY_MS = 400;
const YEARS_BACK = 5;
const CHUNK_DAYS_60M = 60;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDateStrUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Get the latest candle time for symbol+timeframe from DB (UTC). Returns null if none.
 */
async function getLatestCandleTime(symbol, timeframe) {
  if (!isDbConnected()) return null;
  const doc = await Candle.findOne({ symbol, timeframe })
    .sort({ time: -1 })
    .select('time')
    .lean();
  if (!doc?.time) return null;
  return doc.time instanceof Date ? doc.time : new Date(doc.time);
}

/**
 * True if we have data up to "yesterday" (UTC), so incremental sync (today only) is safe.
 */
function isUpToDate(latestTime, now) {
  if (!latestTime || !(latestTime instanceof Date)) return false;
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const latestStr = toDateStrUTC(latestTime);
  const yesterdayStr = toDateStrUTC(yesterday);
  return latestStr >= yesterdayStr;
}

/**
 * Build from/to strings for market hours (NSE 09:15–15:30).
 */
function marketRange(fromDate, toDate, startTime = '09:15:00', endTime = '15:30:00') {
  return {
    from: `${toDateStr(fromDate)} ${startTime}`,
    to: `${toDateStr(toDate)} ${endTime}`,
  };
}

/**
 * Persist candles to DB (same shape as HistoricalRepository).
 * Time is stored in UTC (Date is stored as UTC in MongoDB).
 * @param {string} tradingsymbol - Optional display name (e.g. RELIANCE) from instruments.
 */
async function persistCandles(symbol, timeframe, candles, tradingsymbol = null) {
  if (!isDbConnected() || !candles.length) return 0;
  const setTradingsymbol = tradingsymbol != null && String(tradingsymbol).trim() ? String(tradingsymbol).trim() : undefined;
  const ops = candles.map((c) => {
    const raw = c.time instanceof Date ? c.time : new Date(c.time);
    const time = new Date(raw.getTime()); // ensure UTC moment (MongoDB stores Date as UTC)
    const update = {
      symbol,
      timeframe,
      time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0,
    };
    if (setTradingsymbol) update.tradingsymbol = setTradingsymbol;
    return {
      updateOne: {
        filter: { symbol, timeframe, time },
        update: { $set: update },
        upsert: true,
      },
    };
  });
  const batchSize = 500;
  let written = 0;
  for (let i = 0; i < ops.length; i += batchSize) {
    const batch = ops.slice(i, i + batchSize);
    await Candle.bulkWrite(batch);
    written += batch.length;
  }
  return written;
}

/**
 * Normalize Kite candle (timestamp, open, high, low, close, volume) to DB shape.
 * Timestamp from Kite is UTC (ms or ISO with offset); we keep as UTC for storage.
 * Drops candles with invalid timestamp so they are not persisted.
 */
function normalize(c) {
  if (c == null || c.close == null) return null;
  const ts = c.timestamp != null ? Number(c.timestamp) : NaN;
  const time = Number.isFinite(ts) ? new Date(ts) : null; // UTC
  if (time == null || Number.isNaN(time.getTime())) return null;
  return {
    time,
    open: Number(c.open ?? c.close),
    high: Number(c.high ?? c.close),
    low: Number(c.low ?? c.close),
    close: Number(c.close),
    volume: c.volume != null ? Number(c.volume) : 0,
  };
}

/**
 * Fetch and persist one instrument for one interval.
 */
async function syncInstrumentInterval(apiKey, accessToken, instrument, interval, fromToRanges) {
  const symbol = String(instrument.instrument_token ?? '');
  const tradingsymbol = instrument.tradingsymbol != null ? String(instrument.tradingsymbol).trim() : null;
  const timeframe = interval === 'day' ? 'day' : '60minute';
  let total = 0;
  for (const { from, to } of fromToRanges) {
    try {
      const candles = await getHistoricalCandles({
        apiKey,
        accessToken,
        instrumentToken: symbol,
        interval,
        from,
        to,
        options: { continuous: 0, oi: 0 },
      });
      const normalized = (candles || [])
        .map(normalize)
        .filter((c) => c != null && c.time != null);
      if (normalized.length) {
        const w = await persistCandles(symbol, timeframe, normalized, tradingsymbol);
        total += w;
      } else if ((candles || []).length > 0) {
        logger.warn('KiteNseHistoricalSync', {
          symbol,
          interval,
          from,
          to,
          rawCount: candles.length,
          msg: 'All candles dropped by normalize (check timestamp format)',
        });
      }
    } catch (err) {
      logger.warn('KiteNseHistoricalSync', {
        symbol,
        interval,
        from,
        to,
        error: err?.message,
      });
    }
    await delay(DELAY_MS);
  }
  return total;
}

/**
 * Run sync: NSE equity only, 1h + 1 day, last 5 years.
 * @param {{ accessToken: string, apiKey: string }} session
 * @param {{ limit?: number, instrument_token?: string, tradingsymbol?: string }} options
 *   - limit: cap number of instruments (for testing)
 *   - instrument_token: sync only this instrument (e.g. "256265")
 *   - tradingsymbol: sync only instrument with this tradingsymbol (e.g. "RELIANCE"), case-insensitive
 * @returns {{ instruments: number, candlesDay: number, candles60m: number, errors: string[] }}
 */
export async function syncNseEquityHistorical(session, options = {}) {
  const { accessToken, apiKey } = session;
  const limit = options.limit != null ? Math.max(0, Number(options.limit)) : null;
  const instrumentToken = options.instrument_token != null ? String(options.instrument_token).trim() : null;
  const tradingsymbol = options.tradingsymbol != null ? String(options.tradingsymbol).trim() : null;
  const errors = [];

  if (!isDbConnected()) {
    throw new Error('Database not connected. Set MONGODB_URI and restart.');
  }

  const { instruments: rawList } = await getInstruments(accessToken, apiKey, 'NSE');
  let list = (rawList || []).filter(
    (row) => String(row.instrument_type || '').toUpperCase() === 'EQ',
  );
  if (instrumentToken) {
    list = list.filter((row) => String(row.instrument_token ?? '') === instrumentToken);
  }
  if (tradingsymbol) {
    const tsLower = tradingsymbol.toLowerCase();
    list = list.filter((row) => String(row.tradingsymbol ?? '').toLowerCase() === tsLower);
  }
  if (list.length === 0) {
    throw new Error(
      instrumentToken ? `Instrument token ${instrumentToken} not found in NSE equity list` :
      tradingsymbol ? `Tradingsymbol ${tradingsymbol} not found in NSE equity list` :
      'No NSE equity instruments to sync'
    );
  }
  const instruments = limit != null ? list.slice(0, limit) : list;

  const now = new Date();
  const start = new Date(now);
  start.setFullYear(start.getFullYear() - YEARS_BACK);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const fullDayRanges = [{ ...marketRange(start, now, '09:15:00', '15:30:00') }];
  const incrementalDayRanges = [{ ...marketRange(todayStart, now, '09:15:00', '15:30:00') }];

  const fullRanges60m = [];
  for (let d = new Date(start); d < now; ) {
    const end = new Date(d);
    end.setDate(end.getDate() + CHUNK_DAYS_60M);
    if (end > now) end.setTime(now.getTime());
    fullRanges60m.push(marketRange(d, end));
    d = new Date(end);
    d.setDate(d.getDate() + 1);
  }
  const incrementalRanges60m = [{ ...marketRange(todayStart, now, '09:15:00', '15:30:00') }];

  let candlesDay = 0;
  let candles60m = 0;

  for (let i = 0; i < instruments.length; i++) {
    const inst = instruments[i];
    const token = String(inst.instrument_token ?? '');
    if (!token) continue;
    try {
      const [latestDayTime, latest60mTime] = await Promise.all([
        getLatestCandleTime(token, 'day'),
        getLatestCandleTime(token, '60minute'),
      ]);
      const dayIncremental = isUpToDate(latestDayTime, now);
      const min60Incremental = isUpToDate(latest60mTime, now);
      const dayRanges = dayIncremental ? incrementalDayRanges : fullDayRanges;
      const ranges60m = min60Incremental ? incrementalRanges60m : fullRanges60m;

      if (dayIncremental || min60Incremental) {
        logger.info('KiteNseHistoricalSync', {
          symbol: token,
          dayIncremental: dayIncremental || undefined,
          min60Incremental: min60Incremental || undefined,
        });
      }

      const dayCount = await syncInstrumentInterval(
        apiKey,
        accessToken,
        inst,
        'day',
        dayRanges,
      );
      candlesDay += dayCount;
      const count60 = await syncInstrumentInterval(
        apiKey,
        accessToken,
        inst,
        '60minute',
        ranges60m,
      );
      candles60m += count60;
      if ((i + 1) % 50 === 0) {
        logger.info('KiteNseHistoricalSync', {
          progress: `${i + 1}/${instruments.length}`,
          candlesDay,
          candles60m,
        });
      }
    } catch (err) {
      errors.push(`${token}: ${err?.message ?? err}`);
      logger.warn('KiteNseHistoricalSync instrument failed', {
        instrument_token: token,
        error: err?.message,
      });
    }
    await delay(DELAY_MS);
  }

  return {
    instruments: instruments.length,
    candlesDay,
    candles60m,
    errors: errors.slice(0, 50),
  };
}
