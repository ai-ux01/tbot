/**
 * Resolve human-readable tradingsymbol for paper positions from stored candles (symbol is often instrument token).
 */

import { Candle } from '../database/models/Candle.js';
import { isDbConnected } from '../database/connection.js';

/**
 * @param {object[]} positions - from PaperTradingStore
 * @returns {Promise<object[]>}
 */
export async function enrichPaperPositionsInstrumentNames(positions) {
  if (!isDbConnected() || !Array.isArray(positions) || positions.length === 0) {
    return positions;
  }
  const symbols = [...new Set(positions.map((p) => String(p.symbol || '').trim()).filter(Boolean))];
  if (symbols.length === 0) return positions;

  const rows = await Candle.aggregate([
    { $match: { symbol: { $in: symbols } } },
    { $group: { _id: '$symbol', tradingsymbol: { $first: '$tradingsymbol' } } },
  ]);

  const bySymbol = new Map();
  for (const r of rows) {
    const ts = r.tradingsymbol != null && String(r.tradingsymbol).trim() ? String(r.tradingsymbol).trim() : null;
    if (ts && !/^\d+$/.test(ts)) {
      bySymbol.set(String(r._id), ts);
    }
  }

  return positions.map((p) => {
    const sym = String(p.symbol || '').trim();
    const fromDb = bySymbol.get(sym);
    const existingTs = p.tradingsymbol != null && String(p.tradingsymbol).trim() ? String(p.tradingsymbol).trim() : null;
    const existingReadable = existingTs && !/^\d+$/.test(existingTs) ? existingTs : null;
    const instrumentName = existingReadable || fromDb || null;
    return { ...p, instrumentName };
  });
}

/**
 * @param {object} state - getPaperTradingState()
 */
export async function enrichPaperTradingState(state) {
  if (!state || !Array.isArray(state.positions)) return state;
  const positions = await enrichPaperPositionsInstrumentNames(state.positions);
  return { ...state, positions };
}
