import { EventEmitter } from 'events';
import { DataFeed, DataFeedEvents } from './DataFeed.js';
import { CandleBuilder, CandleBuilderEvents } from './CandleBuilder.js';
import { createStrategy, getStrategyNames } from '../strategies/index.js';
import { RiskManager, RejectReason } from './RiskManager.js';
import { OrderExecutor } from './OrderExecutor.js';
import * as kotakApi from '../services/kotakApi.js';
import { logger } from '../logger.js';

/** Bot lifecycle states */
export const BotState = Object.freeze({
  STOPPED: 'STOPPED',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  ERROR: 'ERROR',
});

export const BotEvents = Object.freeze({
  BOT_STARTED: 'botStarted',
  BOT_STOPPED: 'botStopped',
  BOT_ERROR: 'botError',
});

/** Default strategy when none specified */
const DEFAULT_STRATEGIES = ['emaCross'];

/**
 * BotEngine – lifecycle, DataFeed, candles, multiple strategies.
 * Strategies are loaded dynamically; each maintains separate state. Risk is tracked per strategy.
 * When options.risk and options.instrument + session.baseUrl are set: Strategy signal → RiskManager → OrderExecutor.
 *
 * @param {Object} [options]
 * @param {Object} [options.session] - { auth, sid, baseUrl } for Kotak
 * @param {string|string[]} [options.instrumentToken] - e.g. 'nse_cm|11536'
 * @param {string} [options.wsUrl] - Kotak HSM WebSocket URL
 * @param {Object} [options.risk] - RiskManager config
 * @param {Object} [options.instrument] - { exchangeSegment, tradingSymbol }
 * @param {string|string[]} [options.strategies] - Strategy names to run (e.g. 'emaCross' or ['emaCross', 'breakout']). Default: ['emaCross']
 * @param {Object} [options.strategyOptions] - Per-strategy options: { emaCross: {}, breakout: { lookback: 20 }, ... }
 */
export class BotEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this._state = BotState.STOPPED;
    this._options = options;
    this._dataFeed = null;
    this._candleBuilder = null;
    /** @type {Array<{ name: string, onCandle: Function, getState: Function }>} */
    this._strategyInstances = [];
    this._riskManager = null;
    this._orderExecutor = null;
    this._onCandle = null;
  }

  getDataFeed() {
    return this._dataFeed;
  }

  getCandleBuilder() {
    return this._candleBuilder;
  }

  /** Strategy instances (each has name, onCandle, getState). */
  getStrategies() {
    return this._strategyInstances;
  }

  /** Single strategy instance for backward compatibility (first enabled strategy). */
  getStrategy() {
    return this._strategyInstances.length > 0 ? this._strategyInstances[0] : null;
  }

  getRiskManager() {
    return this._riskManager;
  }

  getOrderExecutor() {
    return this._orderExecutor;
  }

  getStatus() {
    return this._state;
  }

  async start() {
    if (this._state === BotState.RUNNING || this._state === BotState.STARTING) return;
    this._state = BotState.STARTING;
    try {
      await this._doStart();
      this._state = BotState.RUNNING;
      this.emit(BotEvents.BOT_STARTED);
    } catch (err) {
      this._state = BotState.ERROR;
      this.emit(BotEvents.BOT_ERROR, err);
      throw err;
    }
  }

  async stop() {
    if (this._state === BotState.STOPPED) return;
    const previousState = this._state;
    this._state = BotState.STOPPED;
    try {
      await this._doStop(previousState);
      this.emit(BotEvents.BOT_STOPPED);
    } catch (err) {
      this._state = BotState.ERROR;
      this.emit(BotEvents.BOT_ERROR, err);
      throw err;
    }
  }

  async _doStart() {
    const { session, instrumentToken, wsUrl, risk, instrument, strategies: strategyNames, strategyOptions = {} } = this._options;
    if (!session?.auth || !session?.sid) {
      throw new Error('BotEngine: options.session { auth, sid } required');
    }
    if (instrumentToken == null || (Array.isArray(instrumentToken) && instrumentToken.length === 0)) {
      throw new Error('BotEngine: options.instrumentToken required');
    }

    const names = strategyNames == null
      ? DEFAULT_STRATEGIES
      : Array.isArray(strategyNames) ? strategyNames : [strategyNames];
    const validNames = getStrategyNames();
    const toRun = names.filter((n) => validNames.includes(String(n).toLowerCase()));
    if (toRun.length === 0) {
      throw new Error(`BotEngine: no valid strategies. Requested: ${names.join(', ')}; available: ${validNames.join(', ')}`);
    }

    this._dataFeed = new DataFeed({ session, instrumentToken, wsUrl });
    this._candleBuilder = new CandleBuilder();
    this._candleBuilder.start();
    this._dataFeed.on(DataFeedEvents.TICK, (tick) => this._candleBuilder.addTick(tick));

    this._strategyInstances = toRun.map((name) => {
      const opts = strategyOptions[name] ?? strategyOptions[String(name).toLowerCase()] ?? {};
      return createStrategy(name, opts);
    });

    const symbol = instrument?.tradingSymbol ?? null;
    const context = { symbol };

    this._onCandle = (candle) => {
      for (const strategy of this._strategyInstances) {
        const result = strategy.onCandle(candle, context);
        if (result != null && (result.signal === 'BUY' || result.signal === 'SELL')) {
          this._onStrategySignal({ ...result, strategyName: strategy.name });
        }
      }
    };
    this._candleBuilder.on(CandleBuilderEvents.CANDLE, this._onCandle);

    if (session?.baseUrl && risk && instrument?.tradingSymbol) {
      this._riskManager = new RiskManager(risk);
      const placeOrderFn = (jData) =>
        kotakApi.placeOrder(session.baseUrl, session.auth, session.sid, jData);
      this._orderExecutor = new OrderExecutor({
        placeOrderFn,
        instrument: {
          exchangeSegment: instrument.exchangeSegment ?? 'nse_cm',
          tradingSymbol: instrument.tradingSymbol,
        },
      });
      logger.info('BotEngine', { msg: 'Strategy → RiskManager → OrderExecutor enabled', strategies: toRun });
    }

    await this._dataFeed.connect();
  }

  /**
   * Pipeline: strategy signal → RiskManager.approveTrade(signal, price, strategyName) → OrderExecutor (if approved).
   * @private
   */
  async _onStrategySignal(payload) {
    const { signal, candle, strategyName } = payload ?? {};
    const price = candle?.close;
    if (price == null || !Number.isFinite(price)) {
      logger.warn('BotEngine', { msg: 'signal ignored: missing candle.close', signal, strategyName });
      return;
    }

    logger.info('BotEngine', { msg: 'signal', signal, strategyName, price: price.toFixed(2), candleTime: candle?.time });

    if (!this._riskManager) {
      this.emit('signal', { ...payload, strategyName });
      return;
    }

    const riskResult = this._riskManager.approveTrade(signal, price, strategyName);
    if (!riskResult.approved) {
      logger.warn('BotEngine', { msg: 'risk rejected', signal, strategyName, reason: riskResult.reason });
      if (riskResult.reason === RejectReason.MAX_DAILY_LOSS_EXCEEDED) {
        this.emit('circuitBreaker', { reason: riskResult.reason });
      }
      return;
    }

    if (signal === 'HOLD') return;

    if (signal === 'BUY') {
      const qty = riskResult.quantity ?? 0;
      if (qty <= 0) {
        logger.warn('BotEngine', { msg: 'BUY skipped: no quantity', strategyName });
        return;
      }
      const result = await this._orderExecutor.placeMarketOrder('B', qty, price);
      if (!result.success) {
        this._riskManager.clearPosition(strategyName);
        logger.warn('BotEngine', { msg: 'order failed', signal: 'BUY', strategyName, error: result.error });
        return;
      }
      const symbol = this._options.instrument?.tradingSymbol;
      if (symbol) {
        this.emit('signal', { ...payload, strategyName });
        this.emit('tradeOpened', {
          symbol,
          strategyName,
          quantity: qty,
          entryPrice: price,
          stopLoss: riskResult.stopLoss ?? null,
          target: riskResult.target ?? null,
        });
      }
      return;
    }

    if (signal === 'SELL') {
      const qty = riskResult.quantity ?? 0;
      if (qty <= 0) {
        logger.warn('BotEngine', { msg: 'SELL skipped: no quantity', strategyName });
        return;
      }
      const result = await this._orderExecutor.placeMarketOrder('S', qty, price);
      if (!result.success) {
        logger.warn('BotEngine', { msg: 'order failed', signal: 'SELL', strategyName, error: result.error });
        return;
      }
      const symbol = this._options.instrument?.tradingSymbol;
      if (symbol) {
        this.emit('signal', { ...payload, strategyName });
        this.emit('tradeClosed', {
          symbol,
          strategyName,
          exitPrice: price,
          realizedPnl: riskResult.realizedPnl ?? null,
        });
      }
    }
  }

  async _doStop(previousState) {
    this._riskManager = null;
    this._orderExecutor = null;
    if (this._candleBuilder && this._onCandle) {
      this._candleBuilder.off(CandleBuilderEvents.CANDLE, this._onCandle);
      this._onCandle = null;
    }
    this._strategyInstances = [];
    if (this._candleBuilder) {
      this._candleBuilder.stop();
      this._candleBuilder = null;
    }
    if (this._dataFeed) {
      await this._dataFeed.disconnect();
      this._dataFeed = null;
    }
  }
}
