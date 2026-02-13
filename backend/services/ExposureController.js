/**
 * Portfolio Layer: Aggregate exposure checks (wraps PortfolioRiskManager for consistent API).
 * NEW IMPROVEMENTS: Single place for exposure validation before execution.
 */

import { PortfolioRiskManager } from './PortfolioRiskManager.js';

/**
 * ExposureController – Uses PortfolioRiskManager to validate exposure.
 * Can be extended with real-time PnL or margin checks if broker API provides them.
 */
export class ExposureController {
  /**
   * @param {Object} [opts] - Passed to PortfolioRiskManager
   */
  constructor(opts = {}) {
    this._riskManager = new PortfolioRiskManager(opts);
  }

  /**
   * Check if opening a new position is within limits.
   * @param {Array<{ instrumentToken: string, entryPrice: number, quantity: number, sector?: string }>} openPositions
   * @param {{ symbol?: string, sector?: string, entryPrice: number, quantity: number }} proposed
   * @returns {{ allowed: boolean, reason?: string }}
   */
  canOpen(openPositions, proposed) {
    const notional = (proposed.entryPrice ?? 0) * (proposed.quantity ?? 0);
    return this._riskManager.canOpenNewPosition(openPositions, {
      symbol: proposed.symbol,
      sector: proposed.sector,
      notional,
    });
  }
}

export default ExposureController;
