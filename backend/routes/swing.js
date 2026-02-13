/**
 * NEW SWING BOT CODE
 * Routes for swing trading: register instruments, manual evaluate, status, backtest. Does not touch intraday bot.
 * NEW IMPROVEMENTS: Optional PortfolioSwingEngine (liquidity, regime, ATR, portfolio risk, journal); POST /backtest.
 */

import { Router } from 'express';
import { getSession } from '../sessionStore.js';
import { SwingPositionStore } from '../services/SwingPositionStore.js';
import { SwingEngine } from '../engine/SwingEngine.js';
import { PortfolioSwingEngine } from '../engine/PortfolioSwingEngine.js';
import { getTradingConfig } from '../config/tradingConfig.js';
import { emitSwingSignal, emitSwingPositionUpdate, emitSwingStatus } from '../socket.js';
import { runScheduledEvaluation, startScheduler } from '../services/SwingSchedulerService.js';
import { runSwingBacktest } from '../services/SwingBacktestService.js';
import { BrokerSyncService } from '../services/BrokerSyncService.js';
import { logger } from '../logger.js';

const router = Router();

const DEFAULT_RISK = {
  capital: 100_000,
  riskPercentPerTrade: 1,
  stopLossPercent: 2,
};

function getEmitter() {
  return { emitSwingSignal, emitSwingPositionUpdate, emitSwingStatus };
}

function getRiskConfig() {
  const config = getTradingConfig();
  return {
    capital: config.defaultCapital,
    riskPercentPerTrade: config.riskPerTrade * 100,
    stopLossPercent: 2,
  };
}

/** POST /api/swing/start — Register instrument for daily evaluation */
router.post('/start', async (req, res) => {
  try {
    const { sessionId, instrumentToken, instrument } = req.body ?? {};
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    if (!instrumentToken) {
      return res.status(400).json({ error: 'Missing instrumentToken' });
    }
    const session = getSession(sessionId);
    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid', code: 'SESSION_EXPIRED' });
    }
    const inst = instrument ?? {};
    if (!inst.tradingSymbol) {
      return res.status(400).json({ error: 'instrument.tradingSymbol required for order placement' });
    }
    await SwingPositionStore.register({
      sessionId,
      instrumentToken: String(instrumentToken).trim(),
      instrument: {
        exchangeSegment: inst.exchangeSegment ?? 'nse_cm',
        tradingSymbol: inst.tradingSymbol,
      },
    });
    startScheduler(getRiskConfig());
    logger.info('Swing', { msg: 'Instrument registered', instrumentToken });
    res.json({ ok: true, message: 'Registered for daily swing evaluation' });
  } catch (err) {
    const msg = err?.message ?? String(err);
    logger.error('Swing start failed', { error: msg });
    res.status(502).json({ error: msg });
  }
});

/** POST /api/swing/evaluate — Manually trigger evaluation (optional body: sessionId, instrumentToken for single; else all registered) */
router.post('/evaluate', async (req, res) => {
  try {
    const { sessionId, instrumentToken } = req.body ?? {};
    if (sessionId != null && instrumentToken != null) {
      const session = getSession(sessionId);
      if (!session) {
        return res.status(401).json({ error: 'Session expired or invalid', code: 'SESSION_EXPIRED' });
      }
      const registry = await SwingPositionStore.getRegistry();
      const entry = registry.find(
        (e) => String(e.instrumentToken) === String(instrumentToken)
      );
      if (!entry) {
        return res.status(400).json({ error: 'Instrument not registered; call POST /api/swing/start first' });
      }
      const riskConfig = getRiskConfig();
      const usePortfolio = getTradingConfig().usePortfolioSwingEngine;
      const EngineClass = usePortfolio ? PortfolioSwingEngine : SwingEngine;
      const engine = new EngineClass({
        session,
        instrumentToken: entry.instrumentToken,
        instrument: entry.instrument,
        riskConfig,
      });
      const result = await engine.evaluate(getEmitter());
      return res.json({ success: true, result });
    }
    await runScheduledEvaluation(getRiskConfig());
    res.json({ success: true, message: 'Evaluation run for all registered instruments' });
  } catch (err) {
    const msg = err?.message ?? String(err);
    logger.error('Swing evaluate failed', { error: msg });
    res.status(502).json({ error: msg });
  }
});

/** GET /api/swing/status — Return open positions */
router.get('/status', async (req, res) => {
  try {
    const positions = await SwingPositionStore.getAllOpenPositions();
    res.json({ success: true, positions });
  } catch (err) {
    const msg = err?.message ?? String(err);
    logger.error('Swing status failed', { error: msg });
    res.status(502).json({ error: msg });
  }
});

/**
 * POST /api/swing/backtest — DB-only swing backtest (no broker).
 * Body: { symbols: [{ symbol: string }], from?: string, to?: string, capital?: number }
 * Returns: { winRate, avgR, maxDrawdown, totalReturn, tradesCount [, trades, error ] }
 */
router.post('/backtest', async (req, res) => {
  try {
    const { symbols, from, to, capital } = req.body ?? {};
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: 'symbols required: array of { symbol } (symbol = DB Candle.symbol)' });
    }
    const result = await runSwingBacktest({
      symbols,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      capital: capital != null ? Number(capital) : undefined,
    });
    res.json(result);
  } catch (err) {
    const msg = err?.message ?? String(err);
    logger.error('Swing backtest failed', { error: msg });
    res.status(502).json({ error: msg });
  }
});

/**
 * POST /api/swing/reconcile — Fetch broker positions, compare with SwingPositionStore and DB. Log discrepancies.
 * Body: { sessionId: string }
 */
router.post('/reconcile', async (req, res) => {
  try {
    const { sessionId } = req.body ?? {};
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    const session = getSession(sessionId);
    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid', code: 'SESSION_EXPIRED' });
    }
    const result = await BrokerSyncService.reconcile(session);
    res.json({ success: true, ...result });
  } catch (err) {
    const msg = err?.message ?? String(err);
    logger.error('Swing reconcile failed', { error: msg });
    res.status(502).json({ error: msg });
  }
});

export default router;
