/**
 * Kite Connect WebSocket (wss://ws.kite.trade).
 * Connects with api_key and access_token, subscribes to instrument tokens,
 * parses LTP mode binary packets (8 bytes: token, last_price in paise).
 * One connection per sessionId; forwards ticks via callback.
 */

import WebSocket from 'ws';
import { getKiteSession } from '../kiteSessionStore.js';
import { logger } from '../logger.js';

const KITE_WS_URL = 'wss://ws.kite.trade';

/** Parse cookie string for kite_session_id */
function parseKiteSessionCookie(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  const match = cookieHeader.match(/kite_session_id=([^;]+)/);
  return match ? match[1].trim() : null;
}

/**
 * Parse LTP mode binary message. Structure: 2 bytes packet count (int16), then for each packet: 2 bytes length (int16), then packet.
 * LTP packet = 8 bytes: instrument_token (int32), last_price (int32). Price in paise → divide by 100.
 */
function parseLtpBinary(buffer) {
  const ticks = [];
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return ticks;
  const packetCount = buffer.readInt16BE(0);
  let offset = 2;
  for (let i = 0; i < packetCount && offset + 4 <= buffer.length; i++) {
    const packetLen = buffer.readInt16BE(offset);
    offset += 2;
    if (packetLen >= 8 && offset + packetLen <= buffer.length) {
      const instrumentToken = buffer.readInt32BE(offset);
      const lastPricePaise = buffer.readInt32BE(offset + 4);
      const lastPrice = lastPricePaise / 100;
      ticks.push({
        instrument_token: instrumentToken,
        last_price: lastPrice,
        ltp: lastPrice,
        tk: String(instrumentToken),
      });
      offset += packetLen;
    } else {
      offset += packetLen;
    }
  }
  return ticks;
}

const connections = new Map(); // sessionId -> { ws, subscribedTokens: Set, onTicks }

function getOrCreateConnection(sessionId, apiKey, accessToken, onTicks) {
  let conn = connections.get(sessionId);
  if (conn) {
    conn.onTicks = onTicks;
    return conn;
  }

  const url = `${KITE_WS_URL}?api_key=${encodeURIComponent(apiKey)}&access_token=${encodeURIComponent(accessToken)}`;
  const ws = new WebSocket(url);
  const subscribedTokens = new Set();

  ws.on('open', () => {
    logger.info('KiteWebSocketService', { sessionId: sessionId?.slice(0, 8), msg: 'Connected' });
    if (subscribedTokens.size > 0) {
      const tokensArr = Array.from(subscribedTokens);
      ws.send(JSON.stringify({ a: 'subscribe', v: tokensArr }));
      ws.send(JSON.stringify({ a: 'mode', v: ['ltp', tokensArr] }));
    }
  });

  ws.on('message', (data) => {
    if (Buffer.isBuffer(data) && data.length >= 4) {
      const ticks = parseLtpBinary(data);
      if (ticks.length > 0 && conn.onTicks) conn.onTicks(ticks);
    }
    // ignore text (postbacks) and 1-byte heartbeat
  });

  ws.on('error', (err) => {
    logger.warn('KiteWebSocketService', { sessionId: sessionId?.slice(0, 8), error: err?.message });
  });

  ws.on('close', () => {
    connections.delete(sessionId);
    logger.info('KiteWebSocketService', { sessionId: sessionId?.slice(0, 8), msg: 'Closed' });
  });

  conn = { ws, subscribedTokens, onTicks };
  connections.set(sessionId, conn);
  return conn;
}

/**
 * Subscribe to instrument tokens. Tokens are merged with existing.
 * @param {string} sessionId - Kite session id (from cookie)
 * @param {number[]} tokens - Instrument tokens e.g. [408065, 884737]
 * @param {function} onTicks - (ticks: Array<{ instrument_token, last_price, ltp, tk }>) => void
 * @returns {{ success: boolean, error?: string }}
 */
export function subscribe(sessionId, tokens, onTicks) {
  if (!sessionId || !Array.isArray(tokens) || tokens.length === 0) {
    return { success: false, error: 'sessionId and non-empty tokens required' };
  }
  const session = getKiteSession(sessionId);
  if (!session?.apiKey || !session?.accessToken) {
    return { success: false, error: 'Kite session not found or missing api_key/access_token' };
  }

  const conn = getOrCreateConnection(
    sessionId,
    session.apiKey,
    session.accessToken,
    onTicks
  );

  for (const t of tokens) conn.subscribedTokens.add(Number(t));
  const tokensArr = Array.from(conn.subscribedTokens);
  const msg = JSON.stringify({ a: 'subscribe', v: tokensArr });
  const modeMsg = JSON.stringify({ a: 'mode', v: ['ltp', tokensArr] });
  if (conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(msg);
    conn.ws.send(modeMsg);
    logger.info('KiteWebSocketService', { sessionId: sessionId?.slice(0, 8), subscribed: conn.subscribedTokens.size });
  }
  return { success: true };
}

/**
 * Unsubscribe from instrument tokens.
 */
export function unsubscribe(sessionId, tokens) {
  const conn = connections.get(sessionId);
  if (!conn) return { success: true };
  tokens.forEach((t) => conn.subscribedTokens.delete(Number(t)));
  const msg = JSON.stringify({ a: 'unsubscribe', v: tokens });
  if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(msg);
  return { success: true };
}

export function getKiteSessionIdFromCookie(cookieHeader) {
  return parseKiteSessionCookie(cookieHeader);
}

export default { subscribe, unsubscribe, getKiteSessionIdFromCookie };
