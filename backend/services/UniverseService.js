/**
 * Data Layer: Liquidity filtering. Exclude illiquid symbols before strategy evaluation.
 * NEW IMPROVEMENTS: 20-day avg volume, min price; used by PortfolioSwingEngine.
 */

import { getTradingConfig } from '../config/tradingConfig.js';
import { HistoricalRepository } from './HistoricalRepository.js';
import { logger } from '../logger.js';

/**
 * UniverseService – Liquidity and eligibility checks.
 * Before evaluating a stock: average daily volume (20-day) > threshold, close price > minPrice.
 */
export class UniverseService {
  /**
   * Check if instrument is liquid enough to trade.
   * @param {{ baseUrl: string, auth: string, sid: string }} session
   * @param {string} instrumentToken
   * @param {string} [symbol] - For logging
   * @param {{ minPrice?: number, minAvgVolume?: number, lookbackDays?: number }} [overrides] - Override config
   * @returns {Promise<{ liquid: boolean, reason?: string, avgVolume?: number, lastClose?: number }>}
   */
  static async isLiquid(session, instrumentToken, symbol = '', overrides = {}) {
    const config = getTradingConfig();
    const minPrice = overrides.minPrice ?? config.minPrice;
    const minAvgVolume = overrides.minAvgVolume ?? config.minAvgVolume;
    const lookbackDays = overrides.lookbackDays ?? config.liquidityLookbackDays;

    let candles;
    try {
      candles = await HistoricalRepository.getHistorical(session, instrumentToken, 'day', {
        lookbackMonths: Math.ceil(lookbackDays / 22) + 1,
      });
    } catch (err) {
      logger.warn('UniverseService isLiquid: failed to fetch daily candles', {
        instrumentToken,
        symbol,
        error: err?.message,
      });
      return { liquid: false, reason: 'DATA_FETCH_FAILED' };
    }

    if (!candles || candles.length < lookbackDays) {
      return { liquid: false, reason: 'INSUFFICIENT_DAYS', count: candles?.length ?? 0 };
    }

    const recent = candles.slice(-lookbackDays);
    const lastClose = recent[recent.length - 1]?.close;
    if (lastClose == null || !Number.isFinite(lastClose)) {
      return { liquid: false, reason: 'NO_LAST_CLOSE' };
    }
    if (lastClose < minPrice) {
      return { liquid: false, reason: 'BELOW_MIN_PRICE', lastClose, minPrice };
    }

    const volumes = recent.map((c) => (c.volume != null && Number.isFinite(c.volume) ? c.volume : 0));
    const totalVol = volumes.reduce((a, b) => a + b, 0);
    const avgVolume = volumes.length > 0 ? totalVol / volumes.length : 0;
    if (avgVolume < minAvgVolume) {
      return { liquid: false, reason: 'LOW_AVG_VOLUME', avgVolume, minAvgVolume, lastClose };
    }

    return { liquid: true, avgVolume, lastClose };
  }
}

export default UniverseService;
