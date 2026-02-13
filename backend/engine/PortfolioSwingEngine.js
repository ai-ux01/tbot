/**
 * Portfolio Swing Engine: Production-grade swing flow with liquidity, regime, ATR sizing, portfolio risk, journal.
 * NEW IMPROVEMENTS: Data → Strategy → Portfolio risk → Position sizing → Execution → Journal.
 * Does not replace or alter existing intraday bot. Existing SwingEngine remains for backward compatibility.
 */

import * as kotakApi from '../services/kotakApi.js';
import { Strategy, StrategySignals } from '../bot/Strategy.js';
import { HistoricalRepository } from '../services/HistoricalRepository.js';
import { UniverseService } from '../services/UniverseService.js';
import { MarketRegimeService } from '../services/MarketRegimeService.js';
import { PositionSizingService } from '../services/PositionSizingService.js';
import { ExposureController } from '../services/ExposureController.js';
import { SwingPositionStore } from '../services/SwingPositionStore.js';
import { logSwingEntry, logSwingExit } from '../services/SwingTradeJournal.js';
import { getTradingConfig } from '../config/tradingConfig.js';
import { createExecutionContext, ErrorCategory } from '../utils/executionLogger.js';
import { logger } from '../logger.js';

const LOOKBACK_MONTHS = 12;

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

function runStrategy(candles) {
  const strategy = new Strategy();
  const sorted = [...(candles ?? [])].sort((a, b) => (a?.time ?? 0) - (b?.time ?? 0));
  for (const c of sorted) {
    if (c?.close != null && Number.isFinite(c.close)) strategy.addCandle(c);
  }
  return strategy;
}

/**
 * PortfolioSwingEngine – Liquidity filter → Regime filter → EMA strategy → Portfolio risk → ATR sizing → Order → Journal.
 */
export class PortfolioSwingEngine {
  /**
   * @param {Object} options
   * @param {{ baseUrl: string, auth: string, sid: string }} options.session
   * @param {string} options.instrumentToken
   * @param {{ exchangeSegment: string, tradingSymbol: string }} options.instrument
   * @param {Object} [options.riskConfig] - { capital, riskPercentPerTrade, ... }
   */
  constructor(options = {}) {
    const { session, instrumentToken, instrument, riskConfig = {} } = options;
    this._session = session;
    this._instrumentToken = String(instrumentToken ?? '').trim();
    this._instrument = instrument ?? { exchangeSegment: 'nse_cm', tradingSymbol: '' };
    const config = getTradingConfig();
    this._riskConfig = {
      capital: riskConfig.capital ?? config.defaultCapital,
      ...riskConfig,
    };
    this._tradingSymbol = this._instrument.tradingSymbol ?? this._instrumentToken;
  }

  /**
   * Evaluate one instrument: liquidity → regime → strategy → risk → size → place → journal.
   * Same contract as SwingEngine.evaluate(emitter) for drop-in replacement.
   * @param {{ emitSwingSignal?: (d: any) => void, emitSwingPositionUpdate?: (d: any) => void, emitSwingStatus?: (d: any) => void }} [emitter]
   * @returns {Promise<{ action: 'BUY'|'SELL'|null, position: object|null, signal: object, error?: string }>}
   */
  async evaluate(emitter = {}) {
    const { emitSwingSignal, emitSwingPositionUpdate, emitSwingStatus } = emitter;
    const ctx = createExecutionContext('swing');
    const result = { action: null, position: null, signal: {} };

    try {
      ctx.log('PortfolioSwingEngine evaluate start', {
        instrumentToken: this._instrumentToken,
        symbol: this._tradingSymbol,
      });

      const [monthlyCandles, weeklyCandles, dailyCandles] = await Promise.all([
        HistoricalRepository.getHistorical(this._session, this._instrumentToken, 'month', {
          lookbackMonths: LOOKBACK_MONTHS,
        }),
        HistoricalRepository.getHistorical(this._session, this._instrumentToken, 'week', {
          lookbackMonths: LOOKBACK_MONTHS,
        }),
        HistoricalRepository.getHistorical(this._session, this._instrumentToken, 'day', {
          lookbackMonths: LOOKBACK_MONTHS,
        }),
      ]);

      const monthlyStrategy = runStrategy(monthlyCandles);
      const weeklyStrategy = runStrategy(weeklyCandles);
      const dailyStrategy = runStrategy(dailyCandles);

      const macroBullish = monthlyStrategy.isBullish();
      const weeklyBullish = weeklyStrategy.isBullish();
      const dailyCrossover = dailyStrategy.detectFreshCrossover();

      const lastDailyClose =
        dailyCandles?.length > 0 ? dailyCandles[dailyCandles.length - 1]?.close : null;

      result.signal = {
        instrumentToken: this._instrumentToken,
        symbol: this._tradingSymbol,
        macroBullish,
        weeklyBullish,
        dailyCrossover,
        lastClose: lastDailyClose,
      };

      if (emitSwingSignal) emitSwingSignal(result.signal);

      const openPosition = await SwingPositionStore.getOpenPosition(this._instrumentToken);

      // --- New long entry ---
      if (macroBullish && weeklyBullish && dailyCrossover === StrategySignals.BUY && !openPosition) {
        const config = getTradingConfig();

        const liquidity = await UniverseService.isLiquid(
          this._session,
          this._instrumentToken,
          this._tradingSymbol
        );
        if (!liquidity.liquid) {
          result.error = `Liquidity filter: ${liquidity.reason ?? 'NOT_LIQUID'}`;
          ctx.error(ErrorCategory.DATA, result.error, { instrumentToken: this._instrumentToken });
          if (emitSwingStatus) emitSwingStatus({ status: 'evaluated', result });
          return result;
        }

        const regime = await MarketRegimeService.areLongsAllowed(this._session);
        if (!regime.longsAllowed) {
          result.error = `Market regime: ${regime.reason ?? 'LONGS_DISABLED'}`;
          ctx.error(ErrorCategory.STRATEGY, result.error, { instrumentToken: this._instrumentToken });
          if (emitSwingStatus) emitSwingStatus({ status: 'evaluated', result });
          return result;
        }

        const price = lastDailyClose;
        if (price == null || !Number.isFinite(price) || price <= 0) {
          result.error = 'Cannot place BUY: no valid daily close';
          if (emitSwingStatus) emitSwingStatus({ status: 'evaluated', result });
          return result;
        }

        const { quantity, atrValue } = PositionSizingService.getPositionSize(
          dailyCandles,
          price,
          this._riskConfig.capital,
          { riskPerTrade: config.riskPerTrade }
        );
        if (quantity <= 0) {
          result.error = 'ATR position size zero (insufficient data or ATR)';
          if (emitSwingStatus) emitSwingStatus({ status: 'evaluated', result });
          return result;
        }

        const allOpen = await SwingPositionStore.getAllOpenPositions();
        const exposure = new ExposureController({
          capital: this._riskConfig.capital,
          maxOpenPositions: config.maxOpenPositions,
          maxPortfolioExposure: config.maxPortfolioExposure,
          maxSectorExposure: config.maxSectorExposure,
        });
        const canOpen = exposure.canOpen(allOpen, {
          entryPrice: price,
          quantity,
          symbol: this._tradingSymbol,
        });
        if (!canOpen.allowed) {
          result.error = `Portfolio risk: ${canOpen.reason ?? 'BLOCKED'}`;
          ctx.error(ErrorCategory.RISK, result.error, canOpen);
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
          await logSwingEntry({
            symbol: this._tradingSymbol,
            instrumentToken: this._instrumentToken,
            entryPrice: price,
            quantity,
            executionId: ctx.executionId,
          });
          result.action = 'BUY';
          result.position = {
            instrumentToken: this._instrumentToken,
            entryPrice: price,
            quantity,
            entryDate,
            status: 'OPEN',
          };
          ctx.end({ action: 'BUY', quantity, price, atrValue });
          logger.info('PortfolioSwingEngine BUY placed', {
            executionId: ctx.executionId,
            instrumentToken: this._instrumentToken,
            quantity,
            price,
          });
          if (emitSwingPositionUpdate) emitSwingPositionUpdate({ position: result.position });
        } else {
          result.error = orderResponse?.message ?? orderResponse?.error ?? 'Order failed';
          ctx.error(ErrorCategory.EXECUTION, result.error, { instrumentToken: this._instrumentToken });
        }
        if (emitSwingStatus) emitSwingStatus({ status: 'evaluated', result });
        return result;
      }

      // --- Exit: open position and daily SELL crossover ---
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
          const exitPrice = lastDailyClose ?? openPosition.entryPrice;
          await SwingPositionStore.closePosition(this._instrumentToken);
          await logSwingExit({
            instrumentToken: this._instrumentToken,
            exitPrice,
            executionId: ctx.executionId,
          });
          result.action = 'SELL';
          result.position = null;
          ctx.end({ action: 'SELL', quantity });
          logger.info('PortfolioSwingEngine SELL placed', {
            executionId: ctx.executionId,
            instrumentToken: this._instrumentToken,
            quantity,
          });
          if (emitSwingPositionUpdate) emitSwingPositionUpdate({ position: null });
        } else {
          result.error = orderResponse?.message ?? orderResponse?.error ?? 'Order failed';
          ctx.error(ErrorCategory.EXECUTION, result.error, { instrumentToken: this._instrumentToken });
        }
        if (emitSwingStatus) emitSwingStatus({ status: 'evaluated', result });
        return result;
      }

      ctx.end({ action: null });
      if (emitSwingStatus) emitSwingStatus({ status: 'evaluated', result });
      return result;
    } catch (err) {
      const msg = err?.message ?? String(err);
      result.error = msg;
      ctx.error(ErrorCategory.EXECUTION, 'PortfolioSwingEngine evaluate failed', {
        instrumentToken: this._instrumentToken,
        error: msg,
      });
      if (emitSwingStatus) emitSwingStatus({ status: 'error', result });
      return result;
    }
  }
}

export default PortfolioSwingEngine;
