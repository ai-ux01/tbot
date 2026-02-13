/**
 * Portfolio Layer: Portfolio-level risk controls.
 * NEW IMPROVEMENTS: max open positions, max portfolio exposure, max sector exposure; block trades if exceeded.
 */

import { getTradingConfig } from '../config/tradingConfig.js';
import { logger } from '../logger.js';

/**
 * PortfolioRiskManager – Blocks new trades when limits exceeded.
 * Does not execute orders; used by PortfolioSwingEngine before placement.
 */
export class PortfolioRiskManager {
  /**
   * @param {Object} [opts] - Override config
   * @param {number} [opts.maxOpenPositions]
   * @param {number} [opts.maxPortfolioExposure] - Fraction of capital, e.g. 0.5
   * @param {number} [opts.maxSectorExposure] - Fraction per sector, e.g. 0.2
   * @param {number} [opts.capital]
   */
  constructor(opts = {}) {
    const config = getTradingConfig();
    this._maxOpenPositions = opts.maxOpenPositions ?? config.maxOpenPositions;
    this._maxPortfolioExposure = opts.maxPortfolioExposure ?? config.maxPortfolioExposure;
    this._maxSectorExposure = opts.maxSectorExposure ?? config.maxSectorExposure;
    this._capital = opts.capital ?? config.defaultCapital;
  }

  /**
   * Check if a new BUY is allowed given current open positions and (optional) sector.
   * @param {Array<{ instrumentToken: string, entryPrice: number, quantity: number, sector?: string }>} openPositions
   * @param {{ symbol?: string, sector?: string, notional?: number }} [newTrade] - Proposed trade notional (entryPrice * quantity)
   * @returns {{ allowed: boolean, reason?: string }}
   */
  canOpenNewPosition(openPositions, newTrade = {}) {
    const count = openPositions?.length ?? 0;
    if (count >= this._maxOpenPositions) {
      return { allowed: false, reason: 'MAX_OPEN_POSITIONS', current: count, max: this._maxOpenPositions };
    }

    const totalNotional = (openPositions || []).reduce(
      (sum, p) => sum + (p.entryPrice ?? 0) * (p.quantity ?? 0),
      0
    );
    const newNotional = newTrade.notional ?? 0;
    const proposedTotal = totalNotional + newNotional;
    const exposureRatio = this._capital > 0 ? proposedTotal / this._capital : 0;
    if (exposureRatio > this._maxPortfolioExposure) {
      return {
        allowed: false,
        reason: 'MAX_PORTFOLIO_EXPOSURE',
        currentRatio: (totalNotional / this._capital) || 0,
        max: this._maxPortfolioExposure,
      };
    }

    if (newTrade.sector) {
      const sectorNotional =
        (openPositions || [])
          .filter((p) => p.sector === newTrade.sector)
          .reduce((s, p) => s + (p.entryPrice ?? 0) * (p.quantity ?? 0), 0) + newNotional;
      const sectorRatio = this._capital > 0 ? sectorNotional / this._capital : 0;
      if (sectorRatio > this._maxSectorExposure) {
        return {
          allowed: false,
          reason: 'MAX_SECTOR_EXPOSURE',
          sector: newTrade.sector,
          sectorRatio,
          max: this._maxSectorExposure,
        };
      }
    }

    return { allowed: true };
  }
}

export default PortfolioRiskManager;
