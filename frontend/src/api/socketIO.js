/**
 * Socket.IO client helper. Use when your backend uses Socket.IO.
 * Kotak market data uses raw WebSocket (see KotakWSContext); use this for other realtime servers.
 */
import { io } from 'socket.io-client';

/**
 * Create a Socket.IO connection to url (e.g. http://localhost:4000).
 * Returns the socket instance; use socket.on('event', cb), socket.emit('event', data).
 */
export function createSocketIOConnection(url, options = {}) {
  return io(url, {
    autoConnect: true,
    ...options,
  });
}
