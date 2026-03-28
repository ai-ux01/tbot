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
} from '../services/PaperTradingService.js';
import { paperTradingStore } from '../services/PaperTradingStore.js';
import { logger } from '../logger.js';
import { listPaperTrades, summarizePaperTradesByMonth } from '../services/paperTradePersistence.js';

const router = Router();

router.get('/setups', (_req, res) => {
  res.json({ setups: PAPER_TRADING_SETUPS });
});

router.get('/state', (_req, res) => {
  res.json(getPaperTradingState());
});

router.post('/reset', (_req, res) => {
  const state = resetPaperTrading();
  res.json(state);
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
    };
    const out = await applyPaperTick(paperTradingStore, setupId, symbol, orderValueInr, opts);
    res.json(out);
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
    res.json(out);
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
