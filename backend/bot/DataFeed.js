import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { logger } from '../logger.js';

const DEFAULT_WS_URL = 'wss://mlhsm.kotaksecurities.com';
const THROTTLE_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 20;

/** DataFeed event names */
export const DataFeedEvents = Object.freeze({
  TICK: 'tick',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
});

/**
 * Kotak Neo (HSM) WebSocket data feed.
 * Connects with session (auth, sid), subscribes to instrumentToken(s), handles reconnect.
 * Emits: connected, disconnected, error, tick.
 */
export class DataFeed extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} [options.wsUrl] - WebSocket URL (default: Kotak HSM prod)
   * @param {Object} options.session - { auth, sid } from Kotak MPIN
   * @param {string|string[]} options.instrumentToken - e.g. 'nse_cm|11536' or ['nse_cm|11536', 'nse_cm|1594']
   * @param {number} [options.channelNum=1]
   */
  constructor(options = {}) {
    super();
    this._wsUrl = options.wsUrl ?? DEFAULT_WS_URL;
    this._session = options.session ?? null;
    this._instrumentToken = options.instrumentToken;
    this._channelNum = options.channelNum ?? 1;
    this._ws = null;
    this._throttleTimer = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._intent = 'closed'; // 'closed' | 'open'
  }

  /**
   * Connect and subscribe. Idempotent when already connected.
   * @returns {Promise<void>}
   */
  async connect() {
    if (!this._session?.auth || !this._session?.sid) {
      const err = new Error('DataFeed: session.auth and session.sid required');
      this.emit(DataFeedEvents.ERROR, err);
      throw err;
    }

    const tokens = Array.isArray(this._instrumentToken)
      ? this._instrumentToken.join('&')
      : String(this._instrumentToken || '');
    if (!tokens) {
      const err = new Error('DataFeed: instrumentToken required');
      this.emit(DataFeedEvents.ERROR, err);
      throw err;
    }

    this._intent = 'open';
    return this._connect();
  }

  /**
   * Disconnect and stop reconnect. Idempotent when already closed.
   * @returns {Promise<void>}
   */
  async disconnect() {
    this._intent = 'closed';
    this._clearReconnect();
    this._clearThrottle();
    if (this._ws) {
      const ws = this._ws;
      this._ws = null;
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      this.emit(DataFeedEvents.DISCONNECTED);
    }
  }

  _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._reconnectAttempts = 0;
  }

  _clearThrottle() {
    if (this._throttleTimer) {
      clearInterval(this._throttleTimer);
      this._throttleTimer = null;
    }
  }

  _connect() {
    return new Promise((resolve, reject) => {
      try {
        this._ws = new WebSocket(this._wsUrl);
      } catch (err) {
        this.emit(DataFeedEvents.ERROR, err);
        reject(err);
        return;
      }

      const ws = this._ws;
      const tokens = Array.isArray(this._instrumentToken)
        ? this._instrumentToken.join('&')
        : String(this._instrumentToken);

      const onOpen = () => {
        this._clearReconnect();
        this._reconnectAttempts = 0;
        logger.info('DataFeed', { msg: 'WebSocket open, sending auth and subscription', scrips: tokens.slice(0, 50) });
        this._send(ws, { type: 'cn', Authorization: this._session.auth, Sid: this._session.sid });
        this._send(ws, { type: 'mws', scrips: tokens, channelnum: this._channelNum });
        this._throttleTimer = setInterval(() => {
          if (this._ws?.readyState === WebSocket.OPEN) {
            this._send(this._ws, { type: 'ti', scrips: '' });
          }
        }, THROTTLE_INTERVAL_MS);
        this.emit(DataFeedEvents.CONNECTED);
        resolve();
      };

      const onClose = () => {
        this._clearThrottle();
        this._ws = null;
        this.emit(DataFeedEvents.DISCONNECTED);
        if (this._intent === 'open') {
          this._scheduleReconnect(resolve, reject);
        } else {
          resolve();
        }
      };

      const onError = (err) => {
        this.emit(DataFeedEvents.ERROR, err);
        if (!ws.listenerCount('open')) reject(err);
      };

      ws.once('open', onOpen);
      ws.once('close', onClose);
      ws.on('error', onError);

      let firstMessage = true;
      let messageCount = 0;
      ws.on('message', (data) => {
        messageCount += 1;
        try {
          const tick = this._parseMessage(data, tokens);
          if (firstMessage) {
            const preview = Buffer.isBuffer(data) ? `buffer(${data.length})` : typeof data;
            logger.info('DataFeed', { msg: 'First message received', hasLtp: tick?.ltp != null, preview });
            firstMessage = false;
          }
          if (tick) this.emit(DataFeedEvents.TICK, tick);
        } catch (e) {
          logger.warn('DataFeed', { msg: 'Message parse error', error: e?.message, messageNum: messageCount });
          this.emit(DataFeedEvents.ERROR, e);
        }
      });
    });
  }

  _send(ws, obj) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  _scheduleReconnect(resolve, reject) {
    if (this._intent !== 'open' || this._reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      const err = new Error(`DataFeed: reconnect exhausted after ${RECONNECT_MAX_ATTEMPTS} attempts`);
      this.emit(DataFeedEvents.ERROR, err);
      reject(err);
      return;
    }
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempts),
      RECONNECT_MAX_MS
    );
    this._reconnectAttempts += 1;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect().then(resolve).catch(reject);
    }, delay);
  }

  /**
   * Minimal binary parse: HSM sends length (2) + type (1) + payload. Type 6 = data.
   * Emit tick with { instrumentToken, ltp?, raw?, ... } when possible.
   * @private
   */
  _parseMessage(data, instrumentToken) {
    if (Buffer.isBuffer(data) && data.length >= 3) {
      const len = data.readUInt16BE(0);
      const type = data.readUInt8(2);
      if (type === 6 && data.length > 7) {
        const payload = data.subarray(3);
        const ltp = this._tryReadLtp(payload);
        return {
          instrumentToken: instrumentToken.split('&')[0] ?? instrumentToken,
          ltp,
          time: Math.floor(Date.now() / 1000),
          raw: ltp == null ? payload : undefined,
        };
      }
      return {
        instrumentToken: instrumentToken.split('&')[0] ?? instrumentToken,
        time: Math.floor(Date.now() / 1000),
        raw: data,
      };
    }
    return {
      instrumentToken: Array.isArray(this._instrumentToken) ? this._instrumentToken[0] : this._instrumentToken,
      time: Math.floor(Date.now() / 1000),
      raw: data,
    };
  }

  _tryReadLtp(payload) {
    if (payload.length < 4) return undefined;
    try {
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      return view.getFloat32(0);
    } catch {
      return undefined;
    }
  }
}
