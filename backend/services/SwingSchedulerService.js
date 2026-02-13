/**
 * NEW SWING BOT CODE
 * Daily cron at 3:45 PM IST. Evaluates all registered swing instruments. Does not touch intraday bot.
 * NEW IMPROVEMENTS: Uses PortfolioSwingEngine when config.usePortfolioSwingEngine is true.
 */

import cron from 'node-cron';
import { getSession } from '../sessionStore.js';
import { SwingPositionStore } from './SwingPositionStore.js';
import { SwingEngine } from '../engine/SwingEngine.js';
import { PortfolioSwingEngine } from '../engine/PortfolioSwingEngine.js';
import { getTradingConfig } from '../config/tradingConfig.js';
import { emitSwingSignal, emitSwingPositionUpdate, emitSwingStatus } from '../socket.js';
import { logger } from '../logger.js';

// 3:45 PM IST: use '45 15 * * *' if TZ=Asia/Kolkata; if server is UTC use '15 10 * * *' (10:15 UTC = 15:45 IST)
const CRON_IST_1545 = '45 15 * * *';

const DEFAULT_RISK = {
  capital: 100_000,
  riskPercentPerTrade: 1,
  stopLossPercent: 2,
};

let cronTask = null;

function getEmitter() {
  return {
    emitSwingSignal,
    emitSwingPositionUpdate,
    emitSwingStatus,
  };
}

/**
 * Run evaluation for one registered entry. Swallows errors so one failure doesn't stop others.
 */
async function evaluateOne(entry, riskConfig) {
  const { sessionId, instrumentToken, instrument } = entry;
  const session = getSession(sessionId);
  if (!session) {
    logger.warn('SwingScheduler', { msg: 'Session not found, skipping', instrumentToken });
    return;
  }
  const cfg = riskConfig ?? DEFAULT_RISK;
  const usePortfolio = getTradingConfig().usePortfolioSwingEngine;
  const EngineClass = usePortfolio ? PortfolioSwingEngine : SwingEngine;
  const engine = new EngineClass({
    session,
    instrumentToken,
    instrument,
    riskConfig: cfg,
  });
  await engine.evaluate(getEmitter());
}

/**
 * Run evaluation for all registered instruments. Sequential to avoid rate limits.
 */
export async function runScheduledEvaluation(riskConfig) {
  const registry = await SwingPositionStore.getRegistry();
  if (registry.length === 0) {
    logger.info('SwingScheduler', { msg: 'No instruments registered, skipping' });
    return;
  }
  logger.info('SwingScheduler', { msg: 'Running daily evaluation', count: registry.length });
  for (const entry of registry) {
    try {
      await evaluateOne(entry, riskConfig);
    } catch (err) {
      logger.warn('SwingScheduler', {
        msg: 'Evaluation failed for instrument',
        instrumentToken: entry.instrumentToken,
        error: err?.message ?? String(err),
      });
    }
  }
}

/**
 * Start the daily cron job (3:45 PM IST). Idempotent.
 */
export function startScheduler(riskConfig) {
  if (cronTask != null) return;
  cronTask = cron.schedule(CRON_IST_1545, () => {
    runScheduledEvaluation(riskConfig).catch((err) => {
      logger.error('SwingScheduler', { msg: 'Scheduled run failed', error: err?.message ?? String(err) });
    });
  });
  logger.info('SwingScheduler', { msg: 'Scheduler started', cron: CRON_IST_1545 });
}

/**
 * Stop the cron job.
 */
export function stopScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('SwingScheduler', { msg: 'Scheduler stopped' });
  }
}
