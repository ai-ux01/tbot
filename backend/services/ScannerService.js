/**
 * Multi-Timeframe Scanner: 12-month Daily / Weekly / Monthly, EMA 9/21.
 * Uses existing Strategy (bot/Strategy.js) for trend and signal. Does not touch live trading.
 */

import * as kotakApi from './kotakApi.js';
import { Strategy, StrategySignals } from '../bot/Strategy.js';
import { logger } from '../logger.js';

const TREND_BULLISH = 'BULLISH';
const TREND_BEARISH = 'BEARISH';
const TREND_NEUTRAL = 'NEUTRAL';

/**
 * Fetch 12 months of OHLC for one instrument and interval.
 * @param {string} token - instrumentToken
 * @param {string} interval - 'day' | 'week' | 'month'
 * @param {{ baseUrl: string, auth: string, sid: string }} session
 * @returns {Promise<Array<{ time: number, open: number, high: number, low: number, close: number }>>}
 */
async function getHistorical(token, interval, session) {
  const { baseUrl, auth, sid } = session ?? {};
  if (!baseUrl || !auth || !sid) {
    throw new Error('ScannerService: session with baseUrl, auth, sid required');
  }
  return kotakApi.getHistorical(baseUrl, auth, sid, {
    instrumentToken: token,
    interval,
    lookbackMonths: 12,
  });
}

/**
 * Run EMA 9/21 strategy on a sorted list of candles; return last signal and trend.
 * @param {Array<{ time: number, open: number, high: number, low: number, close: number }>} candles
 * @returns {{ lastSignal: string | null, isBullish: boolean }}
 */
function evaluateWithStrategy(candles) {
  const strategy = new Strategy();
  const sorted = [...(candles ?? [])].sort((a, b) => (a?.time ?? 0) - (b?.time ?? 0));
  for (const c of sorted) {
    const close = c?.close;
    if (close != null && Number.isFinite(close)) strategy.addCandle(c);
  }
  const lastSignal = strategy.getLastSignal();
  const isBullish = strategy.isBullish();
  return { lastSignal, isBullish };
}

/**
 * Multi-Timeframe Scanner service. Uses session to fetch historical data; does not modify live bot.
 */
export class ScannerService {
  /**
   * @param {{ baseUrl: string, auth: string, sid: string }} session - from getSession(sessionId)
   */
  constructor(session) {
    this._session = session;
  }

  /**
   * Scan watchlist: for each stock fetch 12m daily/weekly/monthly, apply EMA rules, return bullish only.
   * Process stocks sequentially; use Promise.all only for the 3 timeframes of a single stock.
   * @param {string[]} watchlist - array of instrumentTokens
   * @returns {Promise<Array<{ instrumentToken: string, trend: string, dailySignal: string | null, weeklyTrend: string, monthlyTrend: string, lastClose: number | null }>>}
   */
  async scan(watchlist) {
    const tokens = Array.isArray(watchlist) ? watchlist.filter((t) => t != null && String(t).trim()) : [];
    logger.info('Scanner', { msg: 'Scanner started', watchlistLength: tokens.length });

    const results = [];
    for (const instrumentToken of tokens) {
      try {
        logger.info('Scanner', { msg: 'Evaluating stock', instrumentToken });

        const [dailyCandles, weeklyCandles, monthlyCandles] = await Promise.all([
          getHistorical(instrumentToken, 'day', this._session),
          getHistorical(instrumentToken, 'week', this._session),
          getHistorical(instrumentToken, 'month', this._session),
        ]);

        const daily = evaluateWithStrategy(dailyCandles);
        const weekly = evaluateWithStrategy(weeklyCandles);
        const monthly = evaluateWithStrategy(monthlyCandles);

        const monthlyTrend = monthly.isBullish ? TREND_BULLISH : TREND_BEARISH;
        const weeklyTrend = weekly.isBullish ? TREND_BULLISH : TREND_BEARISH;
        const dailySignal = daily.lastSignal;

        const lastClose = dailyCandles?.length > 0
          ? (dailyCandles[dailyCandles.length - 1]?.close ?? null)
          : (weeklyCandles?.length > 0 ? weeklyCandles[weeklyCandles.length - 1]?.close ?? null : null);

        const allConditions =
          monthly.isBullish &&
          weekly.isBullish &&
          dailySignal === StrategySignals.BUY;

        if (allConditions) {
          const row = {
            instrumentToken,
            trend: 'MULTI_TF_BULLISH',
            dailySignal,
            weeklyTrend,
            monthlyTrend,
            lastClose: lastClose != null ? Number(lastClose) : null,
          };
          results.push(row);
          logger.info('Scanner', { msg: 'Multi-timeframe result', ...row });
        }
      } catch (err) {
        logger.warn('Scanner', { msg: 'Stock evaluation failed', instrumentToken, error: err?.message ?? String(err) });
      }
    }

    logger.info('Scanner', { msg: 'Total bullish stocks found', count: results.length });
    return results;
  }
}
