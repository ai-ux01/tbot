/**
 * NEW SWING BOT CODE
 * Swing trading engine: 12-month multi-timeframe (month/week/day), EMA 9/21, daily signals only.
 * Does NOT use WebSocket, CandleBuilder, or intraday bot. Runs once per day (or on manual evaluate).
 */

import * as kotakApi from '../services/kotakApi.js';
import { Strategy, StrategySignals } from '../bot/Strategy.js';
import { RiskManager } from '../bot/RiskManager.js';
import { SwingPositionStore } from '../services/SwingPositionStore.js';
import { logger } from '../logger.js';

function buildMarketOrderJData(instrument, transactionType, quantity, product = 'CNC', validity = 'DAY') {
  return {
    exchange_segment: instrument.exchangeSegment ?? 'nse_cm',
    trading_symbol: instrument.tradingSymbol ?? '',
    transaction_type: transactionType,
    order_type: 'MKT',
    quantity: String(Math.floor(quantity)),
    price: '0',
    validity,
    product,
    disclosed_quantity: '0',
    trigger_price: '0',
  };
}

const LOOKBACK_MONTHS = 12;

async function getHistorical(session, instrumentToken, interval) {
  const { baseUrl, auth, sid } = session ?? {};
  if (!baseUrl || !auth || !sid) throw new Error('SwingEngine: session with baseUrl, auth, sid required');
  return kotakApi.getHistorical(baseUrl, auth, sid, {
    instrumentToken,
    interval,
    lookbackMonths: LOOKBACK_MONTHS,
  });
}

function runStrategy(candles) {
  const strategy = new Strategy();
  const sorted = [...(candles ?? [])].sort((a, b) => (a?.time ?? 0) - (b?.time ?? 0));
  for (const c of sorted) {
    if (c?.close != null && Number.isFinite(c.close)) strategy.addCandle(c);
  }
  return strategy;
}

/**
 * Swing trading engine: evaluates one instrument using monthly/weekly/daily EMAs and daily crossover signals.
 */
export class SwingEngine {
  /**
   * @param {Object} options
   * @param {{ baseUrl: string, auth: string, sid: string }} options.session
   * @param {string} options.instrumentToken - e.g. 'nse_cm|2881'
   * @param {{ exchangeSegment: string, tradingSymbol: string }} options.instrument - for order placement
   * @param {Object} options.riskConfig - { capital, riskPercentPerTrade, stopLossPercent }
   */
  constructor(options = {}) {
    const { session, instrumentToken, instrument, riskConfig = {} } = options;
    this._session = session;
    this._instrumentToken = String(instrumentToken ?? '').trim();
    this._instrument = instrument ?? { exchangeSegment: 'nse_cm', tradingSymbol: '' };
    this._riskConfig = riskConfig;
  }

  /**
   * Fetch 12m data, run EMA on month/week/day, apply entry/exit rules. Place orders if conditions met.
   * @param {{ emitSwingSignal?: (d: any) => void, emitSwingPositionUpdate?: (d: any) => void, emitSwingStatus?: (d: any) => void }} [emitter] - optional socket emitters
   * @returns {Promise<{ action: 'BUY'|'SELL'|null, position: object|null, signal: object, error?: string }>}
   */
  async evaluate(emitter = {}) {
    const { emitSwingSignal, emitSwingPositionUpdate, emitSwingStatus } = emitter;
    const result = { action: null, position: null, signal: {} };

    try {
      const [monthlyCandles, weeklyCandles, dailyCandles] = await Promise.all([
        getHistorical(this._session, this._instrumentToken, 'month'),
        getHistorical(this._session, this._instrumentToken, 'week'),
        getHistorical(this._session, this._instrumentToken, 'day'),
      ]);

      const monthlyStrategy = runStrategy(monthlyCandles);
      const weeklyStrategy = runStrategy(weeklyCandles);
      const dailyStrategy = runStrategy(dailyCandles);

      const macroBullish = monthlyStrategy.isBullish();
      const weeklyBullish = weeklyStrategy.isBullish();
      const dailyCrossover = dailyStrategy.detectFreshCrossover();

      const lastDailyClose =
        dailyCandles?.length > 0
          ? dailyCandles[dailyCandles.length - 1]?.close
          : null;

      result.signal = {
        instrumentToken: this._instrumentToken,
        macroBullish,
        weeklyBullish,
        dailyCrossover,
        lastClose: lastDailyClose,
      };

      if (emitSwingSignal) emitSwingSignal(result.signal);

      const openPosition = await SwingPositionStore.getOpenPosition(this._instrumentToken);

      // Entry: macro + weekly bullish, daily BUY crossover, no open position
      if (macroBullish && weeklyBullish && dailyCrossover === StrategySignals.BUY && !openPosition) {
        const price = lastDailyClose;
        if (price == null || !Number.isFinite(price) || price <= 0) {
          result.error = 'Cannot place BUY: no valid daily close';
          if (emitSwingStatus) emitSwingStatus({ status: 'evaluated', result });
          return result;
        }
        const riskManager = new RiskManager(this._riskConfig);
        const quantity = riskManager.getPositionSize(price);
        if (quantity <= 0) {
          result.error = 'Position size zero';
          if (emitSwingStatus) emitSwingStatus({ status: 'evaluated', result });
          return result;
        }
        const jData = buildMarketOrderJData(this._instrument, 'B', quantity);
        const orderResponse = await kotakApi.placeOrder(
          this._session.baseUrl,
          this._session.auth,
          this._session.sid,
          jData
        );
        const orderOk = orderResponse?.stat === 'Ok' || orderResponse?.stat === 'OK';
        if (orderOk) {
          const entryDate = new Date().toISOString().slice(0, 10);
          await SwingPositionStore.setPosition({
            instrumentToken: this._instrumentToken,
            entryPrice: price,
            quantity,
            entryDate,
          });
          result.action = 'BUY';
          result.position = {
            instrumentToken: this._instrumentToken,
            entryPrice: price,
            quantity,
            entryDate,
            status: 'OPEN',
          };
          logger.info('SwingEngine', { msg: 'BUY placed', instrumentToken: this._instrumentToken, quantity, price });
          if (emitSwingPositionUpdate) emitSwingPositionUpdate({ position: result.position });
        } else {
          result.error = orderResponse?.message ?? orderResponse?.error ?? 'Order failed';
        }
        if (emitSwingStatus) emitSwingStatus({ status: 'evaluated', result });
        return result;
      }

      // Exit: open position and daily SELL crossover
      if (openPosition && dailyCrossover === StrategySignals.SELL) {
        const quantity = openPosition.quantity;
        const jData = buildMarketOrderJData(this._instrument, 'S', quantity);
        const orderResponse = await kotakApi.placeOrder(
          this._session.baseUrl,
          this._session.auth,
          this._session.sid,
          jData
        );
        const orderOk = orderResponse?.stat === 'Ok' || orderResponse?.stat === 'OK';
        if (orderOk) {
          await SwingPositionStore.closePosition(this._instrumentToken);
          result.action = 'SELL';
          result.position = null;
          logger.info('SwingEngine', { msg: 'SELL placed', instrumentToken: this._instrumentToken, quantity });
          if (emitSwingPositionUpdate) emitSwingPositionUpdate({ position: null });
        } else {
          result.error = orderResponse?.message ?? orderResponse?.error ?? 'Order failed';
        }
        if (emitSwingStatus) emitSwingStatus({ status: 'evaluated', result });
        return result;
      }

      if (emitSwingStatus) emitSwingStatus({ status: 'evaluated', result });
      return result;
    } catch (err) {
      const msg = err?.message ?? String(err);
      logger.error('SwingEngine', { msg: 'evaluate failed', instrumentToken: this._instrumentToken, error: msg });
      result.error = msg;
      if (emitSwingStatus) emitSwingStatus({ status: 'error', result });
      return result;
    }
  }
}
