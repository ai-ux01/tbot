/**
 * Strategy / Filter Layer: Index-based market regime. Disable new long entries when monthly EMA9 < EMA21.
 * NEW IMPROVEMENTS: Optional via config; uses NIFTY 50 (or configured index) monthly candles.
 */

import { getTradingConfig } from '../config/tradingConfig.js';
import { HistoricalRepository } from './HistoricalRepository.js';
import { Strategy } from '../bot/Strategy.js';
import { logger } from '../logger.js';

/**
 * MarketRegimeService – Fetches index (NIFTY 50) monthly data; EMA 9/21.
 * If monthly EMA9 < EMA21 → bearish regime → disable new long entries.
 */
export class MarketRegimeService {
  /**
   * Check if new long entries are allowed based on index monthly trend.
   * @param {{ baseUrl: string, auth: string, sid: string }} session
   * @param {{ enableMarketRegimeFilter?: boolean, nifty50InstrumentToken?: string }} [overrides]
   * @returns {Promise<{ longsAllowed: boolean, reason?: string, ema9?: number, ema21?: number }>}
   */
  static async areLongsAllowed(session, overrides = {}) {
    const config = getTradingConfig();
    if (overrides.enableMarketRegimeFilter === false || config.enableMarketRegimeFilter === false) {
      return { longsAllowed: true, reason: 'FILTER_DISABLED' };
    }
    const token = overrides.nifty50InstrumentToken ?? config.nifty50InstrumentToken;
    if (!token) {
      return { longsAllowed: true, reason: 'NO_INDEX_TOKEN' };
    }
    let candles;
    try {
      candles = await HistoricalRepository.getHistorical(session, token, 'month', {
        lookbackMonths: 24,
      });
    } catch (err) {
      logger.warn('MarketRegimeService: failed to fetch index monthly', { token, error: err?.message });
      return { longsAllowed: true, reason: 'DATA_FETCH_FAILED_FALLBACK_ALLOW' };
    }
    if (!candles || candles.length < 21) {
      return { longsAllowed: true, reason: 'INSUFFICIENT_INDEX_DATA' };
    }
    const strategy = new Strategy();
    const sorted = [...candles].sort((a, b) => (a?.time ?? 0) - (b?.time ?? 0));
    for (const c of sorted) {
      if (c?.close != null && Number.isFinite(c.close)) strategy.addCandle(c);
    }
    const ema9 = strategy.getEma9();
    const ema21 = strategy.getEma21();
    const bullish = strategy.isBullish();
    return {
      longsAllowed: bullish,
      reason: bullish ? 'BULLISH' : 'BEARISH',
      ema9: ema9 ?? undefined,
      ema21: ema21 ?? undefined,
    };
  }
}

export default MarketRegimeService;
