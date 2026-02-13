/**
 * Socket.IO server-side helper. Emit bot events to all connected clients.
 * Call setIO(io) from server after attaching io to the HTTP server.
 */

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
