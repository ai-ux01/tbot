/**
 * Signals API: list signals, get indicators, trigger evaluation.
 */

import { Router } from 'express';
import { Signal } from '../database/models/Signal.js';
import { isDbConnected } from '../database/connection.js';
import { computeIndicators } from '../services/IndicatorService.js';
import { evaluateAndPersistSignal, getCandlesForSignal } from '../services/SignalEngine.js';
import { getAlertService } from '../services/AlertService.js';
import { logger } from '../logger.js';

const router = Router();

// Initialize alert service on first use
getAlertService();

/**
 * GET /api/signals
 * List latest signals. Query: instrument, timeframe, limit (default 50).
 */
router.get('/', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const instrument = (req.query.instrument || '').trim();
    const timeframe = (req.query.timeframe || '').trim();
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const filter = {};
    if (instrument) filter.instrument = instrument;
    if (timeframe) filter.timeframe = timeframe;
    const list = await Signal.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ signals: list });
  } catch (err) {
    logger.error('Signals list failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'List failed' });
  }
});

/**
 * GET /api/signals/indicators
 * Get indicators for symbol + timeframe (from stored candles). Query: symbol, timeframe, limit (default 500).
 */
router.get('/indicators', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const symbol = (req.query.symbol || req.query.instrument || '').trim();
    const timeframe = (req.query.timeframe || 'day').trim();
    const limit = Math.min(500, Math.max(50, parseInt(req.query.limit, 10) || 500));
    if (!symbol) {
      return res.status(400).json({ error: 'symbol or instrument required' });
    }
    const candles = await getCandlesForSignal(symbol, timeframe, limit);
    if (candles.length < 20) {
      return res.json({ indicators: null, message: 'Insufficient candles', count: candles.length });
    }
    const ohlcv = candles.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    const indicators = computeIndicators(ohlcv);
    res.json({ indicators, count: candles.length });
  } catch (err) {
    logger.error('Indicators failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Indicators failed' });
  }
});

/**
 * POST /api/signals/evaluate
 * Body: { instrument, tradingsymbol?, timeframe }
 * Runs full pipeline (indicators + ML + score + persist + alert) and returns the saved signal.
 */
router.post('/evaluate', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const { instrument, tradingsymbol, timeframe } = req.body || {};
    const sym = (instrument || tradingsymbol || '').trim();
    const tf = (timeframe || 'day').trim();
    if (!sym || !tf) {
      return res.status(400).json({ error: 'instrument and timeframe required' });
    }
    const signal = await evaluateAndPersistSignal({
      instrument: sym,
      tradingsymbol: (tradingsymbol || sym).trim(),
      timeframe: tf,
    });
    if (!signal) {
      return res.status(422).json({ error: 'Insufficient candle data for evaluation' });
    }
    res.json(signal);
  } catch (err) {
    logger.error('Evaluate signal failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Evaluate failed' });
  }
});

export default router;
