/**
 * Server-side session store. Broker tokens (auth, sid) never leave the server.
 * Frontend receives only sessionId and baseUrl.
 */

import { randomUUID } from 'crypto';

const store = new Map();

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const timers = new Map();

function clearExpiry(sessionId) {
  const t = timers.get(sessionId);
  if (t) {
    clearTimeout(t);
    timers.delete(sessionId);
  }
}

function setExpiry(sessionId) {
  clearExpiry(sessionId);
  timers.set(
    sessionId,
    setTimeout(() => {
      store.delete(sessionId);
      timers.delete(sessionId);
    }, SESSION_TTL_MS)
  );
}

/**
 * Create a session. Returns { sessionId, baseUrl }. Never returns auth/sid.
 * @param {{ auth: string, sid: string, baseUrl: string }} data
 * @returns {{ sessionId: string, baseUrl: string }}
 */
export function createSession(data) {
  if (!data?.auth || !data?.sid || !data?.baseUrl) {
    throw new Error('sessionStore: auth, sid, baseUrl required');
  }
  const sessionId = randomUUID();
  store.set(sessionId, {
    auth: data.auth,
    sid: data.sid,
    baseUrl: data.baseUrl,
  });
  setExpiry(sessionId);
  return { sessionId, baseUrl: data.baseUrl };
}

/**
 * Get session by id. Returns { auth, sid, baseUrl } or null.
 * Never expose this object to the client.
 */
export function getSession(sessionId) {
  if (!sessionId) return null;
  const s = store.get(sessionId);
  if (!s) return null;
  return { ...s };
}

export function deleteSession(sessionId) {
  if (!sessionId) return;
  clearExpiry(sessionId);
  store.delete(sessionId);
}
