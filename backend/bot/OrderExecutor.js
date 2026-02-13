import { EventEmitter } from 'events';
import { logger } from '../logger.js';

/** OrderExecutor event names */
export const OrderExecutorEvents = Object.freeze({
  ORDER_PLACED: 'orderPlaced',
  ORDER_FAILED: 'orderFailed',
  POSITION_UPDATED: 'positionUpdated',
});

const PRODUCT_DEFAULT = 'MIS';
const VALIDITY_DEFAULT = 'DAY';

/**
 * Places market orders via Kotak REST API. Prevents duplicate orders, tracks open position.
 * Retries once on temporary failure. Emits orderPlaced, orderFailed, positionUpdated.
 * No strategy or risk logic – execution only.
 *
 * @param {Object} options
 * @param { (jData: object) => Promise<object> } options.placeOrderFn - e.g. (jData) => kotak.placeOrder(baseUrl, auth, sid, jData)
 * @param {Object} options.instrument - { exchangeSegment, tradingSymbol } e.g. { exchangeSegment: 'nse_cm', tradingSymbol: 'RELIANCE-EQ' }
 * @param {string} [options.product] - MIS | CNC | NRML
 * @param {string} [options.validity] - DAY | IOC
 */
export class OrderExecutor extends EventEmitter {
  constructor(options = {}) {
    super();
    const { placeOrderFn, instrument = {}, product = PRODUCT_DEFAULT, validity = VALIDITY_DEFAULT } = options;
    if (typeof placeOrderFn !== 'function') {
      throw new Error('OrderExecutor: placeOrderFn (async function) required');
    }
    this._placeOrderFn = placeOrderFn;
    this._exchangeSegment = instrument.exchangeSegment ?? 'nse_cm';
    this._tradingSymbol = instrument.tradingSymbol ?? '';
    this._product = product;
    this._validity = validity;

    /** @type {boolean} */
    this._orderInFlight = false;
    /** @type {{ side: 'LONG', quantity: number, orderId?: string, entryPrice: number } | null} */
    this._position = null;
  }

  /**
   * Place a market order. Prevents duplicate (one in flight; no BUY if long, no SELL if flat).
   * Retries once on temporary failure.
   * @param {'B'|'S'} side - B = Buy, S = Sell
   * @param {number} quantity - Order quantity
   * @param {number} [price] - Reference price (for logging; market order uses MKT)
   * @returns {Promise<{ success: boolean, orderId?: string, error?: string }>}
   */
  async placeMarketOrder(side, quantity, price) {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      const err = 'OrderExecutor: invalid quantity';
      logger.warn('OrderExecutor', { error: err });
      this.emit(OrderExecutorEvents.ORDER_FAILED, { error: err, side, quantity });
      return { success: false, error: err };
    }

    if (this._orderInFlight) {
      const err = 'OrderExecutor: order already in flight, skipping duplicate';
      logger.warn('OrderExecutor', { error: err });
      this.emit(OrderExecutorEvents.ORDER_FAILED, { error: err, side, quantity });
      return { success: false, error: err };
    }

    const isBuy = String(side).toUpperCase() === 'B';
    if (isBuy && this._position != null) {
      const err = 'OrderExecutor: already in position, skipping BUY';
      logger.warn('OrderExecutor', { error: err });
      this.emit(OrderExecutorEvents.ORDER_FAILED, { error: err, side, quantity });
      return { success: false, error: err };
    }
    if (!isBuy && this._position == null) {
      const err = 'OrderExecutor: no position, skipping SELL';
      logger.warn('OrderExecutor', { error: err });
      this.emit(OrderExecutorEvents.ORDER_FAILED, { error: err, side, quantity });
      return { success: false, error: err };
    }

    if (!this._tradingSymbol) {
      const err = 'OrderExecutor: instrument.tradingSymbol not set';
      logger.warn('OrderExecutor', { error: err });
      this.emit(OrderExecutorEvents.ORDER_FAILED, { error: err, side, quantity });
      return { success: false, error: err };
    }

    this._orderInFlight = true;
    const jData = this._buildMarketOrderJData(isBuy ? 'B' : 'S', qty);

    try {
      const result = await this._placeWithRetry(jData);
      this._orderInFlight = false;

      if (result && result.stat != null && String(result.stat) !== 'Ok') {
        const errMsg = result?.message ?? result?.error ?? 'Order rejected';
        this.emit(OrderExecutorEvents.ORDER_FAILED, { error: errMsg, side: isBuy ? 'B' : 'S', quantity: qty });
        logger.error('OrderExecutor', { msg: 'orderFailed', error: errMsg });
        return { success: false, error: errMsg };
      }

      const orderId = result?.nOrdNo ?? result?.orderId ?? null;
      if (orderId != null) {
        if (isBuy) {
          this._position = {
            side: 'LONG',
            quantity: qty,
            orderId: String(orderId),
            entryPrice: Number(price) || 0,
          };
        } else {
          this._position = null;
        }
        this.emit(OrderExecutorEvents.ORDER_PLACED, {
          orderId: String(orderId),
          side: isBuy ? 'B' : 'S',
          quantity: qty,
          price,
          position: this.getPosition(),
        });
        this.emit(OrderExecutorEvents.POSITION_UPDATED, { position: this.getPosition() });
        logger.info('OrderExecutor', 'orderPlaced', { orderId, side: isBuy ? 'B' : 'S', quantity: qty });
        return { success: true, orderId: String(orderId) };
      }

      const errMsg = result?.message ?? result?.error ?? 'Unknown response';
      this.emit(OrderExecutorEvents.ORDER_FAILED, { error: errMsg, side: isBuy ? 'B' : 'S', quantity: qty });
      logger.error('OrderExecutor', { msg: 'orderPlaced response missing nOrdNo', error: errMsg });
      return { success: false, error: errMsg };
    } catch (err) {
      this._orderInFlight = false;
      const msg = err?.message ?? String(err);
      this.emit(OrderExecutorEvents.ORDER_FAILED, { error: msg, side: isBuy ? 'B' : 'S', quantity: qty });
      logger.error('OrderExecutor', { msg: 'orderFailed', error: msg });
      return { success: false, error: msg };
    }
  }

  /**
   * Current open position (from our placed orders), or null.
   * @returns {{ side: string, quantity: number, orderId?: string, entryPrice: number } | null}
   */
  getPosition() {
    return this._position == null ? null : { ...this._position };
  }

  _buildMarketOrderJData(transactionType, quantity) {
    return {
      exchange_segment: this._exchangeSegment,
      trading_symbol: this._tradingSymbol,
      transaction_type: transactionType,
      order_type: 'MKT',
      quantity: String(Math.floor(quantity)),
      price: '0',
      validity: this._validity,
      product: this._product,
      disclosed_quantity: '0',
      trigger_price: '0',
    };
  }

  async _placeWithRetry(jData) {
    try {
      return await this._placeOrderFn(jData);
    } catch (err) {
      if (this._isTemporaryFailure(err)) {
        logger.warn('OrderExecutor', { msg: 'retry once after temporary failure', error: err?.message });
        return await this._placeOrderFn(jData);
      }
      throw err;
    }
  }

  _isTemporaryFailure(err) {
    const code = err?.code ?? err?.status ?? err?.statusCode;
    const msg = (err?.message ?? String(err)).toLowerCase();
    if (code != null && (code === 429 || (code >= 500 && code < 600))) return true;
    if (/502|503|504|timeout|oms|unavailable|econnrefused|etimedout|network/.test(msg)) return true;
    return false;
  }
}
