/**
 * Risk validation only. No order execution.
 * Tracks position and risk per strategy; daily loss is global.
 */

const APPROVED = 'APPROVED';

export const RejectReason = Object.freeze({
  MAX_DAILY_LOSS_EXCEEDED: 'MAX_DAILY_LOSS_EXCEEDED',
  ALREADY_IN_POSITION: 'ALREADY_IN_POSITION',
  NO_POSITION: 'NO_POSITION',
  INVALID_INPUT: 'INVALID_INPUT',
});

/**
 * RiskManager – position sizing, daily loss cap, open position tracking per strategy.
 * Exposes approveTrade(signal, price, strategyName) for risk validation only.
 *
 * @param {Object} options
 * @param {number} options.capital - Total capital (e.g. 100000)
 * @param {number} options.riskPercentPerTrade - Risk per trade, e.g. 1
 * @param {number} options.stopLossPercent - Stop loss from entry, e.g. 2
 * @param {number} options.targetPercent - Target from entry, e.g. 3
 * @param {number} options.maxDailyLossPercent - Max daily loss (of capital) before blocking, e.g. 2
 */
export class RiskManager {
  constructor(options = {}) {
    const {
      capital = 0,
      riskPercentPerTrade = 1,
      stopLossPercent = 2,
      targetPercent = 3,
      maxDailyLossPercent = 2,
    } = options;

    this._capital = Number(capital);
    this._riskPercentPerTrade = Number(riskPercentPerTrade);
    this._stopLossPercent = Number(stopLossPercent);
    this._targetPercent = Number(targetPercent);
    this._maxDailyLossPercent = Number(maxDailyLossPercent);

    /** @type {number} */
    this._dailyLoss = 0;
    /** @type {string | null} YYYY-MM-DD */
    this._dailyLossDate = null;
    /** @type {Record<string, { quantity: number, entryPrice: number, stopLoss: number, target: number }>} per strategyName */
    this._positions = {};
  }

  /**
   * Position size in units: risk amount / (price * stopLossPercent).
   * @param {number} price - Entry/reference price
   * @returns {number} Quantity (may be fractional)
   */
  getPositionSize(price) {
    if (price == null || !Number.isFinite(price) || price <= 0) return 0;
    if (this._stopLossPercent <= 0) return 0;
    const riskAmount = (this._capital * this._riskPercentPerTrade) / 100;
    const lossPerUnit = (price * this._stopLossPercent) / 100;
    if (lossPerUnit <= 0) return 0;
    return riskAmount / lossPerUnit;
  }

  isDailyLossExceeded() {
    this._maybeResetDailyLoss();
    const maxLoss = (this._capital * this._maxDailyLossPercent) / 100;
    return this._dailyLoss >= maxLoss;
  }

  /**
   * Current open position for a strategy, or null.
   * @param {string} strategyName
   * @returns {{ quantity: number, entryPrice: number, stopLoss: number, target: number } | null}
   */
  getPosition(strategyName) {
    const key = strategyName == null ? '' : String(strategyName).trim();
    const pos = this._positions[key];
    return pos == null ? null : { ...pos };
  }

  /**
   * All strategies that currently have an open position.
   * @returns {string[]}
   */
  getPositionStrategyNames() {
    return Object.keys(this._positions);
  }

  /**
   * Clear open position for a strategy (e.g. when order was approved but execution failed).
   * @param {string} strategyName
   */
  clearPosition(strategyName) {
    const key = strategyName == null ? '' : String(strategyName).trim();
    delete this._positions[key];
  }

  /**
   * Validate and optionally size a trade for the given strategy. No order execution.
   * BUY: returns quantity, stopLoss, target when approved; records open position for strategyName.
   * SELL: returns approved and realized P&L; clears position for strategyName; adds loss to daily loss when applicable.
   *
   * @param {string} signal - 'BUY' | 'SELL' | 'HOLD'
   * @param {number} price - Current/reference price
   * @param {string} strategyName - Strategy identifier (required for per-strategy tracking)
   * @returns {{ approved: boolean, reason?: string, quantity?: number, stopLoss?: number, target?: number, realizedPnl?: number }}
   */
  approveTrade(signal, price, strategyName) {
    this._maybeResetDailyLoss();

    const sig = String(signal).toUpperCase();
    const p = Number(price);
    const key = strategyName == null ? '' : String(strategyName).trim();

    if (sig !== 'BUY' && sig !== 'SELL' && sig !== 'HOLD') {
      return { approved: false, reason: RejectReason.INVALID_INPUT };
    }
    if (!Number.isFinite(p) || p <= 0) {
      return { approved: false, reason: RejectReason.INVALID_INPUT };
    }

    if (sig === 'HOLD') {
      return { approved: true };
    }

    if (sig === 'BUY') {
      if (this.isDailyLossExceeded()) {
        return { approved: false, reason: RejectReason.MAX_DAILY_LOSS_EXCEEDED };
      }
      if (this._positions[key] != null) {
        return { approved: false, reason: RejectReason.ALREADY_IN_POSITION };
      }
      const quantity = this.getPositionSize(p);
      const stopLoss = p * (1 - this._stopLossPercent / 100);
      const target = p * (1 + this._targetPercent / 100);
      this._positions[key] = { quantity, entryPrice: p, stopLoss, target };
      return {
        approved: true,
        quantity,
        stopLoss,
        target,
      };
    }

    if (sig === 'SELL') {
      if (this._positions[key] == null) {
        return { approved: false, reason: RejectReason.NO_POSITION };
      }
      const { quantity, entryPrice } = this._positions[key];
      const realizedPnl = (p - entryPrice) * quantity;
      if (realizedPnl < 0) {
        this._dailyLoss += Math.abs(realizedPnl);
      }
      delete this._positions[key];
      return { approved: true, quantity, realizedPnl };
    }

    return { approved: false, reason: RejectReason.INVALID_INPUT };
  }

  _maybeResetDailyLoss() {
    const today = new Date().toISOString().slice(0, 10);
    if (this._dailyLossDate !== today) {
      this._dailyLoss = 0;
      this._dailyLossDate = today;
    }
  }
}
