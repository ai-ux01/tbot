/**
 * Sync NSE equity historical data (1h + 1 day) for last 5 years to DB.
 * Uses Kite instruments (NSE, EQ only) and getHistoricalCandles; persists to Candle collection.
 * Per instrument: checks Mongo first; Kite historical is called only if data is not already updated for today (IST).
 * Bulk sync (no instrument_token) still calls getInstruments once to obtain the NSE EQ list.
 * Incremental: if yesterday's data exists for an instrument, only fetches/stores today; else full sync.
 */

import { getInstruments } from './kiteApi.js';
import { getHistoricalCandles } from './kiteHistorical.js';
import { Candle } from '../database/models/Candle.js';
import { SyncCheckpoint } from '../database/models/SyncCheckpoint.js';
import { isDbConnected } from '../database/connection.js';
import { logger } from '../logger.js';
import { istStartOfCalendarDay, toDateStrIST } from '../utils/istExchangeDate.js';
import pLimit from 'p-limit';

const DELAY_MS = 500;
const YEARS_BACK = 5;
const CHUNK_DAYS_60M = 60;
const CHUNK_DAYS_DAY = 365;
const SYNC_SCOPE_NSE_HISTORICAL = 'kite_nse_historical';

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
 * Get the most recent updatedAt for any candle of this symbol. Returns null if none.
 */
async function getLastUpdatedAt(symbol) {
  if (!isDbConnected()) return null;
  const doc = await Candle.findOne({ symbol })
    .sort({ updatedAt: -1 })
    .select('updatedAt')
    .lean();
  if (!doc?.updatedAt) return null;
  return doc.updatedAt instanceof Date ? doc.updatedAt : new Date(doc.updatedAt);
}

async function getCheckpoint(symbol, timeframe) {
  if (!isDbConnected()) return null;
  const doc = await SyncCheckpoint.findOne({
    scope: SYNC_SCOPE_NSE_HISTORICAL,
    symbol,
    timeframe,
  })
    .select('lastSyncedAt')
    .lean();
  if (!doc?.lastSyncedAt) return null;
  return doc.lastSyncedAt instanceof Date ? doc.lastSyncedAt : new Date(doc.lastSyncedAt);
}

async function setCheckpoint(symbol, timeframe, lastSyncedAt) {
  if (!isDbConnected() || !(lastSyncedAt instanceof Date) || Number.isNaN(lastSyncedAt.getTime())) return;
  await SyncCheckpoint.updateOne(
    {
      scope: SYNC_SCOPE_NSE_HISTORICAL,
      symbol,
      timeframe,
    },
    {
      $set: {
        lastSyncedAt,
      },
    },
    { upsert: true }
  );
}

/**
 * True if the given date is "today" in IST (Asia/Kolkata).
 */
function isTodayIST(date) {
  if (!date || !(date instanceof Date)) return false;
  const now = new Date();
  const opts = { timeZone: 'Asia/Kolkata' };
  const dateStr = date.toLocaleDateString('en-CA', opts);
  const todayStr = now.toLocaleDateString('en-CA', opts);
  return dateStr === todayStr;
}

/**
 * DB-only: skip Kite historical calls if we already synced/have coverage for today's IST session.
 * @returns {{ skip: true, reason: string } | { skip: false, latestDayTime: Date|null, latest60mTime: Date|null }}
 */
async function evaluateDbSkipForToday(token, now) {
  const lastUpdated = await getLastUpdatedAt(token);
  if (lastUpdated && isTodayIST(lastUpdated)) {
    return { skip: true, reason: 'candles_updated_today_ist' };
  }
  const [latestDayTime, latest60mTime] = await Promise.all([
    getLatestCandleTime(token, 'day'),
    getLatestCandleTime(token, '60minute'),
  ]);
  const todayStr = toDateStrIST(now);
  const dayStr = latestDayTime ? toDateStrIST(latestDayTime) : '';
  const m60Str = latest60mTime ? toDateStrIST(latest60mTime) : '';
  if (latestDayTime && latest60mTime && dayStr === todayStr && m60Str === todayStr) {
    return { skip: true, reason: 'latest_day_and_60m_bars_today_ist' };
  }
  return { skip: false, latestDayTime, latest60mTime };
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
 * Build from/to strings for market hours (NSE 09:15–15:30). Date portion is IST calendar day.
 */
function marketRange(fromDate, toDate, startTime = '09:15:00', endTime = '15:30:00') {
  return {
    from: `${toDateStrIST(fromDate)} ${startTime}`,
    to: `${toDateStrIST(toDate)} ${endTime}`,
  };
}

function buildRanges(start, end, chunkDays) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return [];
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) return [];
  if (start >= end) return [];

  const ranges = [];
  for (let d = new Date(start); d < end; ) {
    const chunkEnd = new Date(d);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    ranges.push(marketRange(d, chunkEnd, '09:15:00', '15:30:00'));
    d = new Date(chunkEnd);
    d.setDate(d.getDate() + 1);
  }
  return ranges;
}

function checkpointLastSyncIso(checkpointDay, checkpoint60m) {
  return {
    day: checkpointDay ? checkpointDay.toISOString() : null,
    '60minute': checkpoint60m ? checkpoint60m.toISOString() : null,
  };
}

function newStartKiteFrom(dayRanges, ranges60m) {
  return {
    day: dayRanges[0]?.from ?? null,
    '60minute': ranges60m[0]?.from ?? null,
  };
}

function newEndKiteTo(dayRanges, ranges60m) {
  return {
    day: dayRanges.length ? dayRanges[dayRanges.length - 1].to : null,
    '60minute': ranges60m.length ? ranges60m[ranges60m.length - 1].to : null,
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
      updatedAt: new Date(),
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
  let hadError = false;
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
      hadError = true;
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
  return { total, hadError, timeframe };
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

  let list;
  if (instrumentToken) {
    list = [
      {
        instrument_token: instrumentToken,
        tradingsymbol: tradingsymbol || '',
        instrument_type: 'EQ',
      },
    ];
  } else {
    const { instruments: rawList } = await getInstruments(accessToken, apiKey, 'NSE');
    list = (rawList || []).filter(
      (row) => String(row.instrument_type || '').toUpperCase() === 'EQ',
    );
    if (tradingsymbol) {
      const tsLower = tradingsymbol.toLowerCase();
      list = list.filter((row) => String(row.tradingsymbol ?? '').toLowerCase() === tsLower);
    }
  }
  if (list.length === 0) {
    throw new Error(
      tradingsymbol ? `Tradingsymbol ${tradingsymbol} not found in NSE equity list` :
      'No NSE equity instruments to sync'
    );
  }
  const instruments = limit != null ? list.slice(0, limit) : list;

  const now = new Date();
  const istTodayStart = istStartOfCalendarDay(now);
  const start = new Date(istTodayStart);
  start.setFullYear(start.getFullYear() - YEARS_BACK);

  const todayStart = istTodayStart;

  let candlesDay = 0;
  let candles60m = 0;
  let syncWindow = null;

  for (let i = 0; i < instruments.length; i++) {
    const inst = instruments[i];
    const token = String(inst.instrument_token ?? '');
    if (!token) continue;
    try {
      const dbToday = await evaluateDbSkipForToday(token, now);
      if (dbToday.skip) {
        const [cpDay, cp60] = await Promise.all([
          getCheckpoint(token, 'day'),
          getCheckpoint(token, '60minute'),
        ]);
        logger.info('KiteNseHistoricalSync', {
          symbol: token,
          tradingsymbol: inst.tradingsymbol,
          msg: 'Skipped Kite (local DB already has today)',
          reason: dbToday.reason,
          lastSyncCheckpoint: checkpointLastSyncIso(cpDay, cp60),
        });
        if (instruments.length === 1) {
          syncWindow = {
            instrument_token: token,
            tradingsymbol: inst.tradingsymbol,
            skipped: true,
            reason: dbToday.reason,
            lastSyncCheckpoint: checkpointLastSyncIso(cpDay, cp60),
          };
        }
        continue;
      }
      const { latestDayTime, latest60mTime } = dbToday;
      const [checkpointDay, checkpoint60m] = await Promise.all([
        getCheckpoint(token, 'day'),
        getCheckpoint(token, '60minute'),
      ]);
      const dayIncremental = isUpToDate(latestDayTime, now) || !!checkpointDay;
      const min60Incremental = isUpToDate(latest60mTime, now) || !!checkpoint60m;

      const dayStart = checkpointDay
        ? new Date(Math.max(checkpointDay.getTime(), start.getTime()))
        : (dayIncremental ? todayStart : start);
      const min60Start = checkpoint60m
        ? new Date(Math.max(checkpoint60m.getTime(), start.getTime()))
        : (min60Incremental ? todayStart : start);

      const dayRanges = buildRanges(dayStart, now, CHUNK_DAYS_DAY);
      const ranges60m = buildRanges(min60Start, now, CHUNK_DAYS_60M);

      logger.info('KiteNseHistoricalSync', {
        symbol: token,
        tradingsymbol: inst.tradingsymbol,
        dayIncremental: dayIncremental || undefined,
        min60Incremental: min60Incremental || undefined,
        lastSyncCheckpoint: checkpointLastSyncIso(checkpointDay, checkpoint60m),
        newStartKiteFrom: newStartKiteFrom(dayRanges, ranges60m),
        newEndKiteTo: newEndKiteTo(dayRanges, ranges60m),
        rangeChunks: { day: dayRanges.length, '60minute': ranges60m.length },
      });

      if (instruments.length === 1) {
        syncWindow = {
          instrument_token: token,
          tradingsymbol: inst.tradingsymbol,
          lastSyncCheckpoint: checkpointLastSyncIso(checkpointDay, checkpoint60m),
          newStartKiteFrom: newStartKiteFrom(dayRanges, ranges60m),
          newEndKiteTo: newEndKiteTo(dayRanges, ranges60m),
        };
      }

      if (dayRanges.length === 0 && ranges60m.length === 0) {
        logger.info('KiteNseHistoricalSync', {
          symbol: token,
          tradingsymbol: inst.tradingsymbol,
          msg: 'Skipped Kite (no date ranges to fetch; DB/checkpoints cover window)',
        });
        if (instruments.length === 1) {
          syncWindow = {
            instrument_token: token,
            tradingsymbol: inst.tradingsymbol,
            skipped: true,
            reason: 'no_kite_ranges_needed',
            lastSyncCheckpoint: checkpointLastSyncIso(checkpointDay, checkpoint60m),
          };
        }
        continue;
      }

      const daySync = await syncInstrumentInterval(
        apiKey,
        accessToken,
        inst,
        'day',
        dayRanges,
      );
      candlesDay += daySync.total;
      const min60Sync = await syncInstrumentInterval(
        apiKey,
        accessToken,
        inst,
        '60minute',
        ranges60m,
      );
      candles60m += min60Sync.total;
      await Promise.all([
        !daySync.hadError ? setCheckpoint(token, 'day', now) : Promise.resolve(),
        !min60Sync.hadError ? setCheckpoint(token, '60minute', now) : Promise.resolve(),
      ]);
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
    ...(syncWindow ? { syncWindow } : {}),
  };
}


// CONFIG (tune based on Zerodha limits)
const CONCURRENCY = 5;
const RETRIES = 3;

// Retry wrapper
async function withRetry(fn, retries = RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await delay(500 * (i + 1)); // exponential backoff
    }
  }
}

import Bottleneck from 'bottleneck';

// 🔐 Zerodha-safe limiter
const zerodhaLimiter = new Bottleneck({
  maxConcurrent: 3,        // parallel API calls
  minTime: 350,            // ~3 req/sec
  reservoir: 180,          // per minute cap
  reservoirRefreshAmount: 180,
  reservoirRefreshInterval: 60 * 1000,
});

// 🔁 Rate-limited wrapper
function rateLimitedCall(fn) {
  return zerodhaLimiter.schedule(() => fn());
}

// 🔁 Retry + 429 handling
async function withRetryAndThrottle(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await rateLimitedCall(fn);
    } catch (err) {
      const isRateLimit =
        err?.status === 429 ||
        err?.message?.toLowerCase().includes('too many requests');

      if (isRateLimit) {
        const wait = 1000 * (i + 2); // exponential backoff
        logger.warn('Rate limit hit, backing off', { wait });
        await delay(wait);
        continue;
      }

      if (i === retries - 1) throw err;
      await delay(500 * (i + 1));
    }
  }
}

export async function syncNseEquityHistoricalFast(session, options = {}) {
  const { accessToken, apiKey } = session;

  if (!isDbConnected()) {
    throw new Error('Database not connected. Set MONGODB_URI and restart.');
  }

  const limitOpt = options.limit != null ? Math.max(0, Number(options.limit)) : null;
  const instrumentToken = options.instrument_token?.toString().trim();
  const tradingsymbolRaw = options.tradingsymbol?.toString().trim();
  const tradingsymbolFilter = tradingsymbolRaw?.toLowerCase();

  const errors = [];

  let list;
  if (instrumentToken) {
    list = [
      {
        instrument_token: instrumentToken,
        tradingsymbol: tradingsymbolRaw || '',
        instrument_type: 'EQ',
      },
    ];
  } else {
    // DB cannot supply full NSE EQ universe; one instruments download, then per-symbol DB gate avoids historical Kite when fresh.
    const { instruments: rawList } = await withRetryAndThrottle(() =>
      getInstruments(accessToken, apiKey, 'NSE')
    );

    list = (rawList || []).filter(
      (row) => String(row.instrument_type || '').toUpperCase() === 'EQ'
    );

    if (tradingsymbolFilter) {
      list = list.filter(
        (r) => String(r.tradingsymbol || '').toLowerCase() === tradingsymbolFilter
      );
    }
  }

  if (!list.length) {
    throw new Error('No NSE equity instruments to sync');
  }

  const instruments = limitOpt ? list.slice(0, limitOpt) : list;

  const now = new Date();
  const istTodayStart = istStartOfCalendarDay(now);
  const start = new Date(istTodayStart);
  start.setFullYear(start.getFullYear() - YEARS_BACK);
  const todayStart = istTodayStart;

  const limit = pLimit(CONCURRENCY);
  const singleInstrument = instruments.length === 1;

  const rows = await Promise.all(
    instruments.map((inst, index) =>
      limit(async () => {
        const token = String(inst.instrument_token || '');
        if (!token) return { candlesDay: 0, candles60m: 0, syncWindow: null };

        try {
          const dbToday = await evaluateDbSkipForToday(token, now);
          if (dbToday.skip) {
            const [cpDay, cp60] = await Promise.all([
              getCheckpoint(token, 'day'),
              getCheckpoint(token, '60minute'),
            ]);
            logger.info('KiteNseHistoricalSyncFast', {
              symbol: token,
              tradingsymbol: inst.tradingsymbol,
              msg: 'Skipped Kite (local DB already has today)',
              reason: dbToday.reason,
              lastSyncCheckpoint: checkpointLastSyncIso(cpDay, cp60),
            });
            const sw = singleInstrument
              ? {
                  instrument_token: token,
                  tradingsymbol: inst.tradingsymbol,
                  skipped: true,
                  reason: dbToday.reason,
                  lastSyncCheckpoint: checkpointLastSyncIso(cpDay, cp60),
                }
              : null;
            return { candlesDay: 0, candles60m: 0, syncWindow: sw };
          }

          const { latestDayTime, latest60mTime } = dbToday;
          const [checkpointDay, checkpoint60m] = await Promise.all([
            getCheckpoint(token, 'day'),
            getCheckpoint(token, '60minute'),
          ]);

          const dayIncremental = isUpToDate(latestDayTime, now) || !!checkpointDay;
          const min60Incremental = isUpToDate(latest60mTime, now) || !!checkpoint60m;

          const dayStart = checkpointDay
            ? new Date(Math.max(checkpointDay.getTime(), start.getTime()))
            : (dayIncremental ? todayStart : start);
          const min60Start = checkpoint60m
            ? new Date(Math.max(checkpoint60m.getTime(), start.getTime()))
            : (min60Incremental ? todayStart : start);

          const dayRanges = buildRanges(dayStart, now, CHUNK_DAYS_DAY);
          const ranges60m = buildRanges(min60Start, now, CHUNK_DAYS_60M);

          logger.info('KiteNseHistoricalSyncFast', {
            symbol: token,
            tradingsymbol: inst.tradingsymbol,
            dayIncremental: dayIncremental || undefined,
            min60Incremental: min60Incremental || undefined,
            lastSyncCheckpoint: checkpointLastSyncIso(checkpointDay, checkpoint60m),
            newStartKiteFrom: newStartKiteFrom(dayRanges, ranges60m),
            newEndKiteTo: newEndKiteTo(dayRanges, ranges60m),
            rangeChunks: { day: dayRanges.length, '60minute': ranges60m.length },
          });

          let sw = singleInstrument
            ? {
                instrument_token: token,
                tradingsymbol: inst.tradingsymbol,
                lastSyncCheckpoint: checkpointLastSyncIso(checkpointDay, checkpoint60m),
                newStartKiteFrom: newStartKiteFrom(dayRanges, ranges60m),
                newEndKiteTo: newEndKiteTo(dayRanges, ranges60m),
              }
            : null;

          let daySync = { total: 0, hadError: false };
          let min60Sync = { total: 0, hadError: false };
          if (dayRanges.length > 0 || ranges60m.length > 0) {
            [daySync, min60Sync] = await Promise.all([
              withRetryAndThrottle(() =>
                syncInstrumentInterval(apiKey, accessToken, inst, 'day', dayRanges)
              ),
              withRetryAndThrottle(() =>
                syncInstrumentInterval(apiKey, accessToken, inst, '60minute', ranges60m)
              ),
            ]);
          } else {
            logger.info('KiteNseHistoricalSyncFast', {
              symbol: token,
              tradingsymbol: inst.tradingsymbol,
              msg: 'Skipped Kite (no date ranges; DB/checkpoints cover window)',
            });
            if (singleInstrument) {
              sw = {
                instrument_token: token,
                tradingsymbol: inst.tradingsymbol,
                skipped: true,
                reason: 'no_kite_ranges_needed',
                lastSyncCheckpoint: checkpointLastSyncIso(checkpointDay, checkpoint60m),
              };
            }
          }

          await Promise.all([
            !daySync.hadError ? setCheckpoint(token, 'day', now) : Promise.resolve(),
            !min60Sync.hadError ? setCheckpoint(token, '60minute', now) : Promise.resolve(),
          ]);

          if ((index + 1) % 50 === 0) {
            logger.info('KiteNseHistoricalSyncFast', {
              progress: `${index + 1}/${instruments.length}`,
            });
          }

          return {
            candlesDay: daySync.total,
            candles60m: min60Sync.total,
            syncWindow: sw,
          };
        } catch (err) {
          errors.push(`${token}: ${err?.message || err}`);
          logger.warn('Sync failed', {
            token,
            error: err?.message,
          });
          return { candlesDay: 0, candles60m: 0, syncWindow: null };
        }
      })
    )
  );

  const candlesDay = rows.reduce((a, r) => a + r.candlesDay, 0);
  const candles60m = rows.reduce((a, r) => a + r.candles60m, 0);
  const syncWindow = singleInstrument ? (rows.find((r) => r.syncWindow)?.syncWindow ?? null) : null;

  return {
    instruments: instruments.length,
    candlesDay,
    candles60m,
    errors: errors.slice(0, 50),
    ...(syncWindow ? { syncWindow } : {}),
  };
}