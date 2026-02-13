/**
 * Trade Journal – records OPEN/CLOSED trades in MongoDB.
 * Kept separate from strategy/OrderExecutor; called when orders are filled / position closes.
 */

import { Trade } from './database/models/Trade.js';
import { isDbConnected } from './database/connection.js';
import { logger } from './logger.js';

const DEFAULT_STRATEGY = 'EMA_CROSS';

/**
 * Record a new open trade (order filled – BUY).
 * No-op if DB not connected.
 * @param {{ symbol: string, strategyName?: string, quantity: number, entryPrice: number, stopLoss?: number, target?: number }}
 */
export async function recordOpen(params) {
  if (!isDbConnected()) return;
  const { symbol, strategyName = DEFAULT_STRATEGY, quantity, entryPrice, stopLoss, target } = params ?? {};
  if (!symbol || quantity == null || entryPrice == null) {
    logger.warn('TradeJournal', { msg: 'recordOpen skipped', reason: 'missing symbol/quantity/entryPrice' });
    return;
  }
  try {
    await Trade.create({
      symbol: String(symbol).trim(),
      strategyName: String(strategyName).trim(),
      side: 'BUY',
      quantity: Number(quantity),
      entryPrice: Number(entryPrice),
      stopLoss: stopLoss != null ? Number(stopLoss) : null,
      target: target != null ? Number(target) : null,
      status: 'OPEN',
    });
    logger.info('TradeJournal', { msg: 'recordOpen', symbol, quantity, entryPrice });
  } catch (err) {
    logger.error('TradeJournal recordOpen', { error: err?.message });
  }
}

/**
 * Close the most recent OPEN trade for the symbol + strategyName (position closed – SELL).
 * No-op if DB not connected.
 * @param {{ symbol: string, strategyName?: string, exitPrice: number, realizedPnl?: number }}
 */
export async function recordClose(params) {
  if (!isDbConnected()) return;
  const { symbol, strategyName, exitPrice, realizedPnl } = params ?? {};
  if (!symbol || exitPrice == null) {
    logger.warn('TradeJournal', { msg: 'recordClose skipped', reason: 'missing symbol/exitPrice' });
    return;
  }
  try {
    const query = { symbol: String(symbol).trim(), status: 'OPEN' };
    if (strategyName != null && String(strategyName).trim()) {
      query.strategyName = String(strategyName).trim();
    }
    const open = await Trade.findOne(query)
      .sort({ timestamp: -1 })
      .lean()
      .exec();
    if (!open) {
      logger.warn('TradeJournal', { msg: 'recordClose no OPEN trade', symbol, strategyName });
      return;
    }
    await Trade.updateOne(
      { _id: open._id },
      {
        $set: {
          exitPrice: Number(exitPrice),
          pnl: realizedPnl != null ? Number(realizedPnl) : null,
          status: 'CLOSED',
        },
      }
    );
    logger.info('TradeJournal', { msg: 'recordClose', symbol, strategyName, exitPrice, pnl: realizedPnl });
  } catch (err) {
    logger.error('TradeJournal recordClose', { error: err?.message });
  }
}
