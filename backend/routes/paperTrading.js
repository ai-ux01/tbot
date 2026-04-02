/**
 * Paper trading API: virtual portfolio driven by the same setup evaluators as the backtest hub.
 */

import { Router } from 'express';
import { isDbConnected } from '../database/connection.js';
import {
  PAPER_TRADING_SETUPS,
  evaluatePaperSetup,
  applyPaperTick,
  closePaperPositionAtMarket,
  getPaperTradingState,
  resetPaperTrading,
  runPaperTradingAutoTicks,
  runPaperTradingDailyBarExits,
} from '../services/PaperTradingService.js';
import { paperTradingStore } from '../services/PaperTradingStore.js';
import { logger } from '../logger.js';
import { listPaperTrades, summarizePaperTradesByMonth } from '../services/paperTradePersistence.js';
import { getPaperTradingSchedulerStatus } from '../services/PaperTradingSchedulerService.js';
import { enrichPaperTradingState } from '../services/paperPositionEnrich.js';

const router = Router();

/** Attach `instrumentName` on positions when Mongo candles map token → tradingsymbol. */
async function sendJsonWithEnrichedState(res, payload) {
  if (payload && typeof payload === 'object' && payload.state != null && isDbConnected()) {
    try {
      const state = await enrichPaperTradingState(payload.state);
      return res.json({ ...payload, state });
    } catch {
      /* fall through */
    }
  }
  return res.json(payload);
}

router.get('/setups', (_req, res) => {
  res.json({ setups: PAPER_TRADING_SETUPS });
});

router.get('/schedule-status', (_req, res) => {
  res.json(getPaperTradingSchedulerStatus());
});

router.get('/state', async (_req, res) => {
  try {
    const state = getPaperTradingState();
    if (!isDbConnected()) {
      return res.json(state);
    }
    const enriched = await enrichPaperTradingState(state);
    res.json(enriched);
  } catch (err) {
    logger.error('Paper state enrich failed', { error: err?.message });
    res.json(getPaperTradingState());
  }
});

router.post('/reset', async (_req, res) => {
  const state = await resetPaperTrading();
  if (!isDbConnected()) return res.json(state);
  try {
    return res.json(await enrichPaperTradingState(state));
  } catch {
    return res.json(state);
  }
});

router.post('/preview', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const setupId = String(req.body?.setupId || '').trim();
    const symbol = String(req.body?.symbol || '').trim();
    const opts = {
      timeframe: req.body?.timeframe,
      mode: req.body?.mode,
      thresholds: req.body?.thresholds,
      series: req.body?.series,
    };
    const snap = await evaluatePaperSetup(setupId, symbol, opts);
    if (snap.error) {
      return res.status(400).json(snap);
    }
    res.json(snap);
  } catch (err) {
    logger.error('Paper preview failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Preview failed' });
  }
});

/**
 * POST /auto-tick — run the same batch as the daily cron (PAPER_TRADING_AUTO).
 * Requires DB; uses env config, not request body.
 */
router.post('/auto-tick', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const { runPaperTradingDailyPipeline } = await import('../services/PaperTradingSchedulerService.js');
    const data = await runPaperTradingDailyPipeline({ rows: req.body?.rows });
    res.json({ ok: true, ...data });
  } catch (err) {
    logger.error('Paper auto-tick failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Auto tick failed' });
  }
});

/**
 * POST /tick-batch — run applyPaperTick for each object in body.rows (manual alternative to env).
 */
router.post('/tick-batch', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const results = await runPaperTradingAutoTicks(paperTradingStore, rows);
    res.json({ ok: true, results });
  } catch (err) {
    logger.error('Paper tick-batch failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Tick batch failed' });
  }
});

/**
 * POST /run-daily-bar-exits — SL / partial TP / RSI / max hold for all open positions (same logic as daily cron).
 */
router.post('/run-daily-bar-exits', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const data = await runPaperTradingDailyBarExits(paperTradingStore);
    res.json(data);
  } catch (err) {
    logger.error('Paper run-daily-bar-exits failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Run failed' });
  }
});

/**
 * POST /run-daily-pipeline — bar exits then optional auto ticks (mirrors scheduled job).
 */
router.post('/run-daily-pipeline', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const { runPaperTradingDailyPipeline } = await import('../services/PaperTradingSchedulerService.js');
    const data = await runPaperTradingDailyPipeline({ rows: req.body?.rows });
    res.json(data);
  } catch (err) {
    logger.error('Paper run-daily-pipeline failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Run failed' });
  }
});

router.post('/tick', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const setupId = String(req.body?.setupId || '').trim();
    const symbol = String(req.body?.symbol || '').trim();
    const orderValueInr = req.body?.orderValueInr != null ? Number(req.body.orderValueInr) : 10_000;
    const opts = {
      timeframe: req.body?.timeframe,
      mode: req.body?.mode,
      thresholds: req.body?.thresholds,
      series: req.body?.series,
      profitTargetPct: req.body?.profitTargetPct,
      rsiRemainderExit: req.body?.rsiRemainderExit,
      partialTpFraction: req.body?.partialTpFraction,
      maxHoldingDays: req.body?.maxHoldingDays,
    };
    const out = await applyPaperTick(paperTradingStore, setupId, symbol, orderValueInr, opts);
    return sendJsonWithEnrichedState(res, out);
  } catch (err) {
    logger.error('Paper tick failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Tick failed' });
  }
});

router.post('/close', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const setupId = String(req.body?.setupId || '').trim();
    const symbol = String(req.body?.symbol || '').trim();
    const opts = {
      timeframe: req.body?.timeframe,
      mode: req.body?.mode,
      thresholds: req.body?.thresholds,
      series: req.body?.series,
    };
    const out = await closePaperPositionAtMarket(paperTradingStore, setupId, symbol, opts);
    if (!out.ok) {
      return res.status(400).json(out);
    }
    return sendJsonWithEnrichedState(res, out);
  } catch (err) {
    logger.error('Paper close failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Close failed' });
  }
});

/**
 * GET /trades?month=YYYY-MM&year=YYYY&setupId=&tz=ist|utc&limit=&skip=
 * List persisted closed paper trades (Mongo). Month filter uses tz bucket.
 */
router.get('/trades', async (req, res) => {
  if (!isDbConnected()) {
    return res.json({ trades: [], total: 0, tz: 'ist', monthField: 'exitMonthIst', message: 'Database not connected' });
  }
  try {
    const tz = String(req.query.tz || 'ist').toLowerCase() === 'utc' ? 'utc' : 'ist';
    const data = await listPaperTrades({
      month: req.query.month,
      year: req.query.year,
      setupId: req.query.setupId,
      limit: req.query.limit,
      skip: req.query.skip,
      tz,
    });
    res.json(data);
  } catch (err) {
    logger.error('Paper trades list failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'List failed' });
  }
});

/**
 * GET /trades/by-month?year=YYYY&tz=ist|utc
 * Summary per calendar month (exit month).
 */
router.get('/trades/by-month', async (req, res) => {
  if (!isDbConnected()) {
    return res.json({ months: [], tz: 'ist', monthField: 'exitMonthIst', message: 'Database not connected' });
  }
  try {
    const tz = String(req.query.tz || 'ist').toLowerCase() === 'utc' ? 'utc' : 'ist';
    const data = await summarizePaperTradesByMonth({
      year: req.query.year,
      tz,
    });
    res.json(data);
  } catch (err) {
    logger.error('Paper trades by-month failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Summary failed' });
  }
});

export default router;
