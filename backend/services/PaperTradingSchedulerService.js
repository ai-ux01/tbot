/**
 * Daily paper trading: cron uses timezone Asia/Kolkata (IST) by default — not the OS locale.
 * Override: PAPER_TRADING_CRON, PAPER_TRADING_CRON_TZ.
 * 1) Bar-based exits (SL / partial TP / RSI remainder / max hold) for every open position — on by default;
 *    disable with PAPER_TRADING_DAILY_BAR_EXITS=0.
 * 2) Optional auto entry ticks: PAPER_TRADING_AUTO_ENABLED=1 and PAPER_TRADING_AUTO JSON array of
 *    { "setupId", "symbol", "orderValueInr"?, "series"?, "profitTargetPct"?, "rsiRemainderExit"?, "maxHoldingDays"? }.
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
  const envRows = parseAutoRows();
  const warnings = [];

  let rowsToTick = [];
  let source = 'none';
  if (bodyRows.length > 0) {
    rowsToTick = bodyRows;
    source = 'request_body';
  } else if (autoEnabled() && envRows.length > 0) {
    rowsToTick = envRows;
    source = 'env';
  } else {
    if (!autoEnabled()) {
      warnings.push(
        'Auto-entry ticks skipped: set PAPER_TRADING_AUTO_ENABLED=1 in server .env, or POST { "rows": [...] } from the client.',
      );
    } else if (envRows.length === 0) {
      warnings.push(
        'Auto-entry ticks skipped: PAPER_TRADING_AUTO is empty or invalid JSON. Example: [{"setupId":"rsi-ma-setup-copy","symbol":"INFY","orderValueInr":10000,"series":"day"}]',
      );
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
  };
}

export function startPaperTradingScheduler() {
  if (cronTask != null) return;
  const rows = parseAutoRows();
  const wantAuto = autoEnabled() && rows.length > 0;
  const wantExits = dailyBarExitsEnabled();
  if (!wantExits && !wantAuto) {
    logger.info('PaperTradingScheduler', {
      msg: 'Scheduler not started (bar exits disabled via PAPER_TRADING_DAILY_BAR_EXITS=0 and no auto ticks)',
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
    autoTickSymbols: wantAuto ? rows.length : 0,
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
