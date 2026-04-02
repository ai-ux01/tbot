/**
 * Daily paper trading: cron uses timezone Asia/Kolkata (IST) by default — not the OS locale.
 * Override: PAPER_TRADING_CRON, PAPER_TRADING_CRON_TZ.
 * 1) Bar-based exits (SL / partial TP / RSI remainder / max hold) for every open position — on by default;
 *    disable with PAPER_TRADING_DAILY_BAR_EXITS=0.
 * 2) Auto entry ticks from:
 *    - Live RSI↓MA copy daily BUY scan (stored candles), on by default — disable with PAPER_TRADING_RSI_MA_COPY_LIVE=0.
 *    - Plus optional PAPER_TRADING_AUTO JSON when PAPER_TRADING_AUTO_ENABLED=1 (same-symbol rows override scan defaults).
 *    applyPaperTick skips new BUY while a position is open for that setup+symbol.
 */

import cron from 'node-cron';
import { isDbConnected } from '../database/connection.js';
import { logger } from '../logger.js';
import { paperTradingStore } from './PaperTradingStore.js';
import {
  runPaperTradingAutoTicks,
  runPaperTradingDailyBarExits,
} from './PaperTradingService.js';
import { fetchRsiMaCopyLiveDailyPaperRows } from './rsiMaCopyLivePaperScan.js';

/** Default 11:59 AM in `PAPER_TRADING_CRON_TZ` (not system local time). */
const DEFAULT_CRON = '59 11 * * *';
const DEFAULT_TZ = 'Asia/Kolkata';

/** @type {{ getNextRun?: () => Date | null; stop: () => void } | null} */
let cronTask = null;

function cronExpression() {
  const raw = String(process.env.PAPER_TRADING_CRON || '').trim();
  return raw || DEFAULT_CRON;
}

function cronTimezone() {
  const raw = String(process.env.PAPER_TRADING_CRON_TZ || '').trim();
  return raw || DEFAULT_TZ;
}

function parseAutoRows() {
  const raw = process.env.PAPER_TRADING_AUTO;
  if (!raw || !String(raw).trim()) return [];
  try {
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    return j.filter((r) => r && String(r.setupId || '').trim() && String(r.symbol || '').trim());
  } catch (e) {
    logger.warn('PaperTradingScheduler', { msg: 'Invalid PAPER_TRADING_AUTO JSON', error: e?.message });
    return [];
  }
}

function normalizeBodyRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r && String(r.setupId || '').trim() && String(r.symbol || '').trim());
}

function autoEnabled() {
  const v = String(process.env.PAPER_TRADING_AUTO_ENABLED || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * When true (default), scheduled / manual pipeline (no request body) scans DB for rsi-ma-setup-copy live daily BUY
 * and runs applyPaperTick for each. Set PAPER_TRADING_RSI_MA_COPY_LIVE=0 to disable.
 */
function rsiMaCopyLiveEnabled() {
  const v = String(process.env.PAPER_TRADING_RSI_MA_COPY_LIVE ?? '1').toLowerCase().trim();
  return v !== '0' && v !== 'false' && v !== 'no';
}

function paperOrderValueInrFromEnv() {
  const raw = process.env.PAPER_TRADING_ORDER_VALUE_INR;
  const n = raw != null && String(raw).trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 10_000;
}

function rsiMaCopyScanOptsFromEnv() {
  const out = { orderValueInr: paperOrderValueInrFromEnv() };
  const lim = process.env.PAPER_TRADING_RSI_MA_COPY_SCAN_LIMIT;
  if (lim != null && String(lim).trim() !== '') {
    const n = Number(lim);
    if (Number.isFinite(n) && n > 0) out.symbolLimit = Math.floor(n);
  }
  const ptp = process.env.PAPER_TRADING_RSI_MA_COPY_PROFIT_TARGET_PCT;
  if (ptp != null && String(ptp).trim() !== '') {
    const n = Number(ptp);
    if (Number.isFinite(n) && n > 0) out.profitTargetPct = n;
  }
  const rsi = process.env.PAPER_TRADING_RSI_MA_COPY_RSI_REMAINDER_EXIT;
  if (rsi != null && String(rsi).trim() !== '') {
    const n = Number(rsi);
    if (Number.isFinite(n)) out.rsiRemainderExit = n;
  }
  const mh = process.env.PAPER_TRADING_RSI_MA_COPY_MAX_HOLDING_DAYS;
  if (mh != null && String(mh).trim() !== '') {
    const n = Number(mh);
    if (Number.isFinite(n) && n >= 1) out.maxHoldingDays = Math.floor(n);
  }
  const ptf = process.env.PAPER_TRADING_RSI_MA_COPY_PARTIAL_TP_FRACTION;
  if (ptf != null && String(ptf).trim() !== '') {
    const n = Number(ptf);
    if (Number.isFinite(n) && n > 0) out.partialTpFraction = n;
  }
  return out;
}

/**
 * Env rows overlay live rows for the same setupId+symbol (custom order size / params).
 * @param {object[]} liveRows
 * @param {object[]} envRows
 */
function mergeLiveAndEnvPaperRows(liveRows, envRows) {
  const map = new Map();
  const keyOf = (r) => `${String(r.setupId || '').trim()}::${String(r.symbol || '').trim().toUpperCase()}`;
  for (const r of liveRows) {
    const k = keyOf(r);
    if (!k.endsWith('::')) map.set(k, { ...r });
  }
  for (const r of envRows) {
    const k = keyOf(r);
    if (!k.endsWith('::')) continue;
    const prev = map.get(k);
    map.set(k, prev ? { ...prev, ...r } : { ...r });
  }
  return [...map.values()];
}

/** Default on; set PAPER_TRADING_DAILY_BAR_EXITS=0 to skip daily exit scan. */
function dailyBarExitsEnabled() {
  const v = String(process.env.PAPER_TRADING_DAILY_BAR_EXITS || '').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

/**
 * One daily run: manage open positions first, then optional auto-entry ticks.
 * @param {{ rows?: object[] }} [options] — optional `rows` from POST body: used for this run only (overrides env when non-empty).
 */
export async function runPaperTradingDailyPipeline(options = {}) {
  if (!isDbConnected()) {
    logger.warn('PaperTradingScheduler', {
      msg: 'Daily paper pipeline skipped — database not connected (need MONGODB_URI + successful connect)',
    });
    return {
      exits: null,
      auto: [],
      meta: {
        warnings: ['Database not connected — set MONGODB_URI and ensure MongoDB is reachable.'],
        autoRowsUsed: 0,
        source: 'none',
      },
    };
  }

  let exits = null;
  if (dailyBarExitsEnabled()) {
    exits = await runPaperTradingDailyBarExits(paperTradingStore);
    logger.info('PaperTradingScheduler', {
      msg: 'Daily bar exits pass',
      openPositions: exits.processed,
      positionsWithExitOutcome: exits.results?.length ?? 0,
    });
  }

  const bodyRows = normalizeBodyRows(options.rows);
  const envRows = autoEnabled() ? parseAutoRows() : [];
  const warnings = [];

  let rowsToTick = [];
  let source = 'none';
  let liveRsiMeta = { enabled: false, buyCount: 0, symbolsChecked: 0 };

  if (bodyRows.length > 0) {
    rowsToTick = bodyRows;
    source = 'request_body';
  } else {
    let liveRows = [];
    if (rsiMaCopyLiveEnabled()) {
      liveRsiMeta.enabled = true;
      try {
        const scan = await fetchRsiMaCopyLiveDailyPaperRows(rsiMaCopyScanOptsFromEnv());
        liveRows = scan.rows;
        liveRsiMeta.buyCount = scan.liveBuyCount;
        liveRsiMeta.symbolsChecked = scan.symbolsChecked;
        logger.info('PaperTradingScheduler', {
          msg: 'RSI↓MA copy live daily BUY scan',
          symbolsChecked: scan.symbolsChecked,
          liveBuyCount: scan.liveBuyCount,
        });
      } catch (err) {
        logger.warn('PaperTradingScheduler', { msg: 'Live RSI↓MA copy scan failed', error: err?.message });
        warnings.push(`Live RSI↓MA copy scan failed: ${err?.message ?? String(err)}`);
      }
    }

    rowsToTick = mergeLiveAndEnvPaperRows(liveRows, envRows);

    if (rowsToTick.length > 0) {
      if (liveRows.length > 0 && envRows.length > 0) source = 'live_rsi_ma_copy+env';
      else if (liveRows.length > 0) source = 'live_rsi_ma_copy';
      else source = 'env';
    } else {
      if (!rsiMaCopyLiveEnabled() && !autoEnabled()) {
        warnings.push(
          'Auto-entry ticks skipped: enable live scan (default) or set PAPER_TRADING_AUTO_ENABLED=1, or POST { "rows": [...] }.',
        );
      } else if (!rsiMaCopyLiveEnabled() && envRows.length === 0) {
        warnings.push(
          'Auto-entry ticks skipped: PAPER_TRADING_RSI_MA_COPY_LIVE=0 and PAPER_TRADING_AUTO is empty.',
        );
      } else if (rsiMaCopyLiveEnabled() && liveRsiMeta.buyCount === 0 && envRows.length === 0) {
        warnings.push(
          'No auto-entry rows: live RSI↓MA copy scan found 0 BUY on latest daily bar across stored symbols, and PAPER_TRADING_AUTO is empty.',
        );
      }
    }
  }

  let auto = [];
  if (rowsToTick.length > 0) {
    logger.info('PaperTradingScheduler', { msg: 'Running daily paper auto ticks', count: rowsToTick.length, source });
    auto = await runPaperTradingAutoTicks(paperTradingStore, rowsToTick);
    for (const r of auto) {
      if (r.ok === false && r.error) {
        logger.warn('PaperTradingScheduler', {
          msg: 'Tick failed',
          setupId: r.setupId,
          symbol: r.symbol,
          error: r.error,
        });
      }
    }
  }

  logger.info('PaperTradingScheduler', {
    msg: 'Daily paper pipeline finished',
    hadOpenPositions: (exits?.processed ?? 0) > 0,
    autoTickCount: auto.length,
  });

  return {
    exits,
    auto,
    meta: {
      warnings,
      autoRowsUsed: rowsToTick.length,
      source,
      dailyBarExitsRan: dailyBarExitsEnabled(),
      openPositionsChecked: exits?.processed ?? 0,
      liveRsiMaCopy: liveRsiMeta,
    },
  };
}

/** @deprecated use runPaperTradingDailyPipeline */
export async function runPaperTradingScheduledOnce() {
  const { auto } = await runPaperTradingDailyPipeline({});
  return auto;
}

export function getPaperTradingSchedulerStatus() {
  const expression = cronExpression();
  const timezone = cronTimezone();
  const nextRun = cronTask?.getNextRun?.() ?? null;
  return {
    scheduled: cronTask != null,
    cron: expression,
    timezone,
    nextRun: nextRun ? nextRun.toISOString() : null,
    dailyBarExits: dailyBarExitsEnabled(),
    autoEnabled: autoEnabled(),
    autoSymbolRows: parseAutoRows().length,
    rsiMaCopyLive: rsiMaCopyLiveEnabled(),
    paperOrderValueInr: paperOrderValueInrFromEnv(),
  };
}

export function startPaperTradingScheduler() {
  if (cronTask != null) return;
  const rows = parseAutoRows();
  const wantAuto = autoEnabled() && rows.length > 0;
  const wantLiveRsiMa = rsiMaCopyLiveEnabled();
  const wantExits = dailyBarExitsEnabled();
  if (!wantExits && !wantAuto && !wantLiveRsiMa) {
    logger.info('PaperTradingScheduler', {
      msg: 'Scheduler not started (bar exits off, PAPER_TRADING_RSI_MA_COPY_LIVE=0, and no PAPER_TRADING_AUTO)',
    });
    return;
  }

  const expression = cronExpression();
  const timezone = cronTimezone();
  if (typeof cron.validate === 'function' && !cron.validate(expression)) {
    logger.error('PaperTradingScheduler', { msg: 'Invalid PAPER_TRADING_CRON expression', cron: expression });
    return;
  }

  cronTask = cron.schedule(
    expression,
    () => {
      runPaperTradingDailyPipeline().catch((err) => {
        logger.error('PaperTradingScheduler', {
          msg: 'Scheduled paper run failed',
          error: err?.message ?? String(err),
        });
      });
    },
    { timezone },
  );

  const nextRun = cronTask.getNextRun?.();
  logger.info('PaperTradingScheduler', {
    msg: 'Scheduler started',
    cron: expression,
    timezone,
    nextRun: nextRun ? nextRun.toISOString() : null,
    dailyBarExits: wantExits,
    autoTickEnvSymbols: wantAuto ? rows.length : 0,
    liveRsiMaCopyScan: wantLiveRsiMa,
    note: 'Fire time is in the timezone above (default Asia/Kolkata = IST), not necessarily system local time.',
  });
}

export function stopPaperTradingScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('PaperTradingScheduler', { msg: 'Scheduler stopped' });
  }
}
