/**
 * Trade journal: log swing entry and exit to DB (swing_trades).
 * NEW IMPROVEMENTS: Automatic logging on entry/exit; rMultiple and durationDays on close.
 */

import { isDbConnected } from '../database/connection.js';
import { SwingTrade } from '../database/models/SwingTrade.js';
import { logger } from '../logger.js';

/** Default ATR multiple for R (e.g. 1R = 1 ATR risk). */
const DEFAULT_ATR_R = 1;

/**
 * Log entry: create OPEN swing_trades document.
 * @param {{ symbol: string, instrumentToken: string, entryPrice: number, quantity: number, executionId?: string }} params
 * @returns {Promise<object|null>} Created doc or null if DB unavailable
 */
export async function logSwingEntry(params) {
  if (!isDbConnected()) {
    logger.debug('SwingTradeJournal: DB not connected, skip log entry');
    return null;
  }
  const { symbol, instrumentToken, entryPrice, quantity, executionId } = params;
  const doc = await SwingTrade.create({
    symbol: String(symbol ?? ''),
    instrumentToken: String(instrumentToken ?? '').trim(),
    entryDate: new Date(),
    entryPrice: Number(entryPrice),
    quantity: Number(quantity),
    status: 'OPEN',
  });
  logger.info('Swing trade entry logged', {
    executionId,
    swingTradeId: doc._id?.toString(),
    instrumentToken,
    symbol,
    quantity,
    entryPrice,
  });
  return doc;
}

/**
 * Log exit: find OPEN by instrumentToken, set exitDate, exitPrice, pnl, rMultiple, durationDays, status CLOSED.
 * @param {{ instrumentToken: string, exitPrice: number, executionId?: string }} params
 * @returns {Promise<object|null>} Updated doc or null
 */
export async function logSwingExit(params) {
  if (!isDbConnected()) {
    logger.debug('SwingTradeJournal: DB not connected, skip log exit');
    return null;
  }
  const { instrumentToken, exitPrice, executionId } = params;
  const open = await SwingTrade.findOne({
    instrumentToken: String(instrumentToken).trim(),
    status: 'OPEN',
  }).sort({ entryDate: -1 });

  if (!open) {
    logger.warn('SwingTradeJournal: no OPEN trade found for exit', { instrumentToken, executionId });
    return null;
  }

  const exitDate = new Date();
  const pnl = (Number(exitPrice) - open.entryPrice) * open.quantity;
  const durationDays = Math.round(
    (exitDate.getTime() - new Date(open.entryDate).getTime()) / (24 * 60 * 60 * 1000)
  );
  const riskPerShare = open.entryPrice * 0.02; // 2% stop as 1R for simplicity; can pass ATR later
  const rMultiple = riskPerShare > 0 ? (exitPrice - open.entryPrice) / riskPerShare : null;

  open.exitDate = exitDate;
  open.exitPrice = Number(exitPrice);
  open.pnl = pnl;
  open.rMultiple = rMultiple != null ? Math.round(rMultiple * 100) / 100 : null;
  open.durationDays = durationDays;
  open.status = 'CLOSED';
  await open.save();

  logger.info('Swing trade exit logged', {
    executionId,
    swingTradeId: open._id?.toString(),
    instrumentToken,
    pnl,
    rMultiple: open.rMultiple,
    durationDays,
  });
  return open;
}

/**
 * Get open swing trade for instrument (from DB journal). Use when reconciling with file store.
 * @param {string} instrumentToken
 * @returns {Promise<object|null>}
 */
export async function getOpenSwingTrade(instrumentToken) {
  if (!isDbConnected()) return null;
  return SwingTrade.findOne({
    instrumentToken: String(instrumentToken).trim(),
    status: 'OPEN',
  })
    .sort({ entryDate: -1 })
    .lean();
}
