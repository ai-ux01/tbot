import { Router } from 'express';
import { runBacktest } from '../bot/BacktestingEngine.js';
import { BacktestResult } from '../database/models/BacktestResult.js';
import { isDbConnected } from '../database/connection.js';
import { logger } from '../logger.js';

const router = Router();
const RESULTS_LIMIT = 50;

/**
 * POST /api/backtest/run
 * Body: { strategyName, symbol, timeframe, candles[, risk, strategyOptions] }
 * Runs backtest, saves to BacktestResult, returns result + equityCurve.
 */
router.post('/run', async (req, res) => {
  try {
    const { strategyName, symbol, timeframe, candles, risk, strategyOptions } = req.body ?? {};
    if (!strategyName || !symbol || !timeframe) {
      return res.status(400).json({
        error: 'Missing strategyName, symbol, or timeframe',
      });
    }
    if (!Array.isArray(candles)) {
      return res.status(400).json({
        error: 'candles must be an array of { time, open, high, low, close }',
      });
    }

    const result = await runBacktest({
      strategyName: String(strategyName).trim(),
      symbol: String(symbol).trim(),
      timeframe: String(timeframe).trim(),
      candles,
      risk: risk && typeof risk === 'object' ? risk : undefined,
      strategyOptions: strategyOptions && typeof strategyOptions === 'object' ? strategyOptions : undefined,
    });

    if (isDbConnected()) {
      await BacktestResult.create({
        strategyName: result.strategyName,
        symbol: result.symbol,
        timeframe: result.timeframe,
        totalTrades: result.totalTrades,
        winRate: result.winRate,
        totalPnL: result.totalPnL,
        maxDrawdown: result.maxDrawdown,
        sharpeRatio: result.sharpeRatio ?? null,
      });
      logger.info('Backtest saved', {
        strategyName: result.strategyName,
        symbol: result.symbol,
        totalTrades: result.totalTrades,
        totalPnL: result.totalPnL,
      });
    }

    res.json(result);
  } catch (err) {
    const msg = err?.message ?? String(err);
    logger.error('Backtest run failed', { error: msg });
    res.status(400).json({ error: msg });
  }
});

/**
 * GET /api/backtest/results
 * Last 50 backtest results, sorted by createdAt descending.
 */
router.get('/results', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const results = await BacktestResult.find()
      .sort({ createdAt: -1 })
      .limit(RESULTS_LIMIT)
      .lean()
      .exec();
    res.json(results);
  } catch (err) {
    logger.error('GET /api/backtest/results', { error: err?.message });
    res.status(502).json({ error: err?.message ?? 'Failed to fetch results' });
  }
});

export default router;
