/**
 * In-memory paper portfolio (single shared instance for the server process).
 * One open long per (setupId, symbol). Not persisted across restarts.
 */

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class PaperTradingStore {
  constructor() {
    const raw = process.env.PAPER_TRADING_CAPITAL;
    const n = raw != null && raw !== '' ? Number(raw) : NaN;
    this.initialCapital = Number.isFinite(n) && n > 0 ? n : 1_000_000;
    this.reset();
  }

  reset() {
    this.cash = this.initialCapital;
    /** @type {Map<string, object>} */
    this.positions = new Map();
    /** @type {object[]} */
    this.closedTrades = [];
  }

  positionKey(setupId, symbol) {
    return `${String(setupId).trim()}::${String(symbol).trim().toUpperCase()}`;
  }

  getOpen(setupId, symbol) {
    return this.positions.get(this.positionKey(setupId, symbol)) ?? null;
  }

  /**
   * @returns {{ success: boolean, position?: object, error?: string }}
   */
  openLong({ setupId, symbol, tradingsymbol, qty, price, snapshot, orderValueInr }) {
    const key = this.positionKey(setupId, symbol);
    if (this.positions.has(key)) {
      return { success: false, error: 'Already have an open paper position for this setup and symbol.' };
    }
    const q = Math.floor(Number(qty));
    const px = Number(price);
    if (!Number.isFinite(q) || q < 1 || !Number.isFinite(px) || px <= 0) {
      return { success: false, error: 'Invalid quantity or price.' };
    }
    const cost = q * px;
    if (cost > this.cash + 1e-9) {
      return { success: false, error: 'Insufficient paper cash for this order size.' };
    }
    this.cash -= cost;
    const position = {
      id: newId(),
      setupId,
      symbol: String(symbol).trim(),
      tradingsymbol: tradingsymbol || symbol,
      qty: q,
      entryPrice: px,
      openedAt: new Date().toISOString(),
      snapshot: snapshot || null,
      orderValueInr:
        orderValueInr != null && Number.isFinite(Number(orderValueInr)) ? Number(orderValueInr) : null,
    };
    this.positions.set(key, position);
    return { success: true, position };
  }

  /**
   * @param {object} [exitSnapshot] - full setup evaluation at exit (stored in DB)
   * @returns {{ success: boolean, trade?: object, error?: string }}
   */
  closeLong(setupId, symbol, exitPrice, reason = 'manual_or_signal', exitSnapshot = null) {
    const key = this.positionKey(setupId, symbol);
    const pos = this.positions.get(key);
    if (!pos) {
      return { success: false, error: 'No open paper position for this setup and symbol.' };
    }
    const px = Number(exitPrice);
    if (!Number.isFinite(px) || px <= 0) {
      return { success: false, error: 'Invalid exit price.' };
    }
    const proceeds = pos.qty * px;
    const cost = pos.qty * pos.entryPrice;
    const realizedPnl = proceeds - cost;
    this.cash += proceeds;
    this.positions.delete(key);
    const trade = {
      id: newId(),
      paperPositionId: pos.id,
      setupId: pos.setupId,
      symbol: pos.symbol,
      tradingsymbol: pos.tradingsymbol,
      qty: pos.qty,
      entryPrice: pos.entryPrice,
      openedAt: pos.openedAt,
      orderValueInr: pos.orderValueInr ?? null,
      entrySnapshot: pos.snapshot ?? null,
      exitPrice: px,
      closedAt: new Date().toISOString(),
      realizedPnl,
      returnPct: cost > 0 ? realizedPnl / cost : 0,
      exitReason: reason,
      exitSnapshot: exitSnapshot && typeof exitSnapshot === 'object' ? { ...exitSnapshot } : null,
      investedAmount: cost,
      proceedsAmount: proceeds,
    };
    this.closedTrades.unshift(trade);
    if (this.closedTrades.length > 500) this.closedTrades.length = 500;
    return { success: true, trade };
  }

  getState() {
    const positions = [...this.positions.values()];
    const investedOpen = positions.reduce((s, p) => s + p.qty * p.entryPrice, 0);
    return {
      initialCapital: this.initialCapital,
      cash: Math.round(this.cash * 100) / 100,
      investedOpen: Math.round(investedOpen * 100) / 100,
      positions,
      closedTrades: [...this.closedTrades],
    };
  }
}

export const paperTradingStore = new PaperTradingStore();
