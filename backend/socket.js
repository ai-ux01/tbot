/**
 * Socket.IO server-side helper. Emit bot events to all connected clients.
 * Call setIO(io) from server after attaching io to the HTTP server.
 */

import { subscribe as kiteWsSubscribe, getKiteSessionIdFromCookie } from './services/KiteWebSocketService.js';

let _io = null;
/** @type {() => ({ tick?: object, candle?: object, signal?: object, positionUpdate?: object, botStatus?: object }) | null} */
let _getSnapshot = null;

export function setIO(io) {
  _io = io;
  if (_io) {
    _io.on('connection', (socket) => {
      const snapshot = _getSnapshot?.() ?? null;
      if (snapshot && typeof snapshot === 'object') {
        if (snapshot.tick != null) socket.emit('tick', snapshot.tick);
        if (snapshot.candle != null) socket.emit('candle', snapshot.candle);
        if (snapshot.signal != null) socket.emit('signal', snapshot.signal);
        if (snapshot.positionUpdate != null) socket.emit('positionUpdate', snapshot.positionUpdate);
        if (snapshot.botStatus != null) socket.emit('botStatus', snapshot.botStatus);
        if (snapshot.circuitBreaker != null) socket.emit('circuitBreaker', snapshot.circuitBreaker);
      }

      socket.on('kiteWsSubscribe', (payload, cb) => {
        const tokens = Array.isArray(payload) ? payload : (payload?.tokens ?? []);
        const sessionId = getKiteSessionIdFromCookie(socket.handshake?.headers?.cookie ?? '');
        if (!sessionId) {
          (typeof cb === 'function') && cb({ success: false, error: 'Kite session not found. Log in with Kite first.' });
          return;
        }
        socket.join('kite-' + sessionId);
        const result = kiteWsSubscribe(sessionId, tokens, (ticks) => {
          if (_io) _io.to('kite-' + sessionId).emit('kiteTick', ticks);
        });
        (typeof cb === 'function') && cb(result);
      });
    });
  }
}

export function setSnapshotGetter(fn) {
  _getSnapshot = fn;
}

function broadcast(event, data) {
  if (_io) _io.emit(event, data);
}

export function emitTick(data) {
  broadcast('tick', data);
}

export function emitCandle(data) {
  broadcast('candle', data);
}

export function emitSignal(data) {
  broadcast('signal', data);
}

export function emitPositionUpdate(data) {
  broadcast('positionUpdate', data);
}

export function emitBotStatus(data) {
  broadcast('botStatus', data);
}

export function emitCircuitBreaker(data) {
  broadcast('circuitBreaker', data);
}

// --- NEW SWING BOT CODE: separate namespace, do not modify existing events above ---

export function emitSwingSignal(data) {
  broadcast('swingSignal', data);
}

export function emitSwingPositionUpdate(data) {
  broadcast('swingPositionUpdate', data);
}

export function emitSwingStatus(data) {
  broadcast('swingStatus', data);
}
