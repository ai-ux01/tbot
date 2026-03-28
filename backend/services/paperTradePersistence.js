/**
 * Persist closed paper trades to MongoDB and query by month.
 */

import { PaperTrade } from '../database/models/PaperTrade.js';
import { isDbConnected } from '../database/connection.js';
import { logger } from '../logger.js';

/** @param {string|Date} isoOrDate */
export function exitMonthUtc(isoOrDate) {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** @param {string|Date} isoOrDate */
export function exitMonthIst(isoOrDate) {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  if (!y || !m) return null;
  return `${y}-${m}`;
}

/**
 * @param {object} trade - from PaperTradingStore.closeLong
 * @param {object} [extra]
 * @param {object} [extra.exitSnapshot] - full evaluate snapshot at exit
 * @param {number} [extra.initialCapital]
 */
export async function persistPaperClosedTrade(trade, extra = {}) {
  if (!isDbConnected()) return null;
  if (!trade || !trade.closedAt) return null;

  const closedAt = new Date(trade.closedAt);
  const mu = exitMonthUtc(closedAt);
  const mi = exitMonthIst(closedAt);
  if (!mu || !mi) {
    logger.warn('paperTradePersistence: bad closedAt', { closedAt: trade.closedAt });
    return null;
  }

  const invested = Number(trade.investedAmount ?? trade.qty * trade.entryPrice);
  const proceeds = Number(trade.proceedsAmount ?? trade.qty * trade.exitPrice);

  try {
    const doc = await PaperTrade.create({
      portfolioId: 'default',
      paperPositionId: trade.paperPositionId ?? trade.id,
      setupId: trade.setupId,
      symbol: trade.symbol,
      tradingsymbol: trade.tradingsymbol ?? trade.symbol,
      qty: trade.qty,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      investedAmount: invested,
      proceedsAmount: proceeds,
      openedAt: new Date(trade.openedAt),
      closedAt,
      exitMonthUtc: mu,
      exitMonthIst: mi,
      realizedPnl: Number(trade.realizedPnl),
      returnPct: trade.returnPct != null ? Number(trade.returnPct) : null,
      exitReason: trade.exitReason ?? null,
      orderValueInr: trade.orderValueInr != null ? Number(trade.orderValueInr) : null,
      initialCapitalSnapshot: extra.initialCapital != null ? Number(extra.initialCapital) : null,
      entrySnapshot: trade.entrySnapshot ?? null,
      exitSnapshot: extra.exitSnapshot ?? trade.exitSnapshot ?? null,
    });
    return doc.toObject();
  } catch (err) {
    logger.error('paperTradePersistence: insert failed', { error: err?.message });
    return null;
  }
}

/**
 * @param {object} q
 * @param {string} [q.portfolioId]
 * @param {string} [q.month] - YYYY-MM (matches exitMonthUtc or exitMonthIst based on tz)
 * @param {string} [q.year] - YYYY — filter months starting with year-
 * @param {'utc'|'ist'} [q.tz]
 * @param {string} [q.setupId]
 * @param {number} [q.limit]
 * @param {number} [q.skip]
 */
export async function listPaperTrades(q = {}) {
  if (!isDbConnected()) return { trades: [], total: 0 };
  const portfolioId = q.portfolioId || 'default';
  const tz = q.tz === 'utc' ? 'utc' : 'ist';
  const field = tz === 'utc' ? 'exitMonthUtc' : 'exitMonthIst';

  const filter = { portfolioId };
  if (q.setupId) filter.setupId = String(q.setupId).trim();
  if (q.month && /^\d{4}-\d{2}$/.test(q.month)) {
    filter[field] = q.month;
  } else if (q.year && /^\d{4}$/.test(String(q.year))) {
    filter[field] = new RegExp(`^${q.year}-`);
  }

  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
  const skip = Math.max(0, Number(q.skip) || 0);

  const [trades, total] = await Promise.all([
    PaperTrade.find(filter).sort({ closedAt: -1 }).skip(skip).limit(limit).lean(),
    PaperTrade.countDocuments(filter),
  ]);

  return { trades, total, tz, monthField: field };
}

/**
 * Aggregate PnL and counts by calendar month.
 * @param {object} q
 * @param {string} [q.portfolioId]
 * @param {string} [q.year] - optional YYYY filter
 * @param {'utc'|'ist'} [q.tz]
 */
export async function summarizePaperTradesByMonth(q = {}) {
  if (!isDbConnected()) return { months: [], tz: q.tz === 'utc' ? 'utc' : 'ist' };
  const portfolioId = q.portfolioId || 'default';
  const tz = q.tz === 'utc' ? 'utc' : 'ist';
  const monthField = tz === 'utc' ? 'exitMonthUtc' : 'exitMonthIst';

  const match = { portfolioId };
  if (q.year && /^\d{4}$/.test(String(q.year))) {
    match[monthField] = new RegExp(`^${q.year}-`);
  }

  const rows = await PaperTrade.aggregate([
    { $match: match },
    {
      $group: {
        _id: `$${monthField}`,
        tradeCount: { $sum: 1 },
        totalPnl: { $sum: '$realizedPnl' },
        totalInvested: { $sum: '$investedAmount' },
        wins: {
          $sum: { $cond: [{ $gt: ['$realizedPnl', 0] }, 1, 0] },
        },
      },
    },
    { $sort: { _id: -1 } },
    { $limit: 120 },
  ]);

  const months = rows.map((r) => ({
    month: r._id,
    tradeCount: r.tradeCount,
    totalPnl: Math.round(r.totalPnl * 100) / 100,
    totalInvested: Math.round(r.totalInvested * 100) / 100,
    winRate: r.tradeCount > 0 ? r.wins / r.tradeCount : 0,
  }));

  return { months, tz, monthField };
}
