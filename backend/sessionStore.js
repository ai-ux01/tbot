/**
 * Server-side Kotak broker session store (auth JWT, Neo sid, baseUrl).
 * Optional disk persistence so restarts do not drop sessions (dev-friendly).
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Persist to backend/data/kotak-broker-sessions.json (override with KOTAK_SESSION_STORE_PATH). */
const STORE_FILE = process.env.KOTAK_SESSION_STORE_PATH
  ? path.resolve(process.env.KOTAK_SESSION_STORE_PATH)
  : path.join(__dirname, 'data', 'kotak-broker-sessions.json');

/**
 * Non-production: persist by default (survive nodemon / kill 4000).
 * Production: only if KOTAK_PERSIST_SESSIONS=1|true. Disable anywhere: KOTAK_PERSIST_SESSIONS=0|false.
 */
const PERSIST =
  process.env.KOTAK_PERSIST_SESSIONS === '1' ||
  process.env.KOTAK_PERSIST_SESSIONS === 'true' ||
  (process.env.NODE_ENV === 'production'
    ? false
    : process.env.KOTAK_PERSIST_SESSIONS !== '0' && process.env.KOTAK_PERSIST_SESSIONS !== 'false');

const store = new Map();
const timers = new Map();
/** Neo broker `sid` → app `sessionId` (same row as `store`) so clients can send Kotak `Sid` in headers. */
const sidByNeo = new Map();

function clearExpiry(sessionId) {
  const t = timers.get(sessionId);
  if (t) {
    clearTimeout(t);
    timers.delete(sessionId);
  }
}

function setExpiry(sessionId, expiresAt) {
  clearExpiry(sessionId);
  const delay = Math.max(0, expiresAt - Date.now());
  timers.set(
    sessionId,
    setTimeout(() => {
      removeSessionEntry(sessionId);
    }, delay),
  );
}

function persistToDisk() {
  if (!PERSIST) return;
  try {
    const dir = path.dirname(STORE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const sessions = {};
    const now = Date.now();
    for (const [id, v] of store.entries()) {
      if (v.expiresAt > now) {
        sessions[id] = {
          auth: v.auth,
          sid: v.sid,
          baseUrl: v.baseUrl,
          expiresAt: v.expiresAt,
        };
      }
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify({ sessions }, null, 0), 'utf8');
  } catch {
    /* avoid crashing API on disk errors */
  }
}

function loadFromDisk() {
  if (!PERSIST) return;
  try {
    if (!fs.existsSync(STORE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    const sessions = raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {};
    const now = Date.now();
    for (const [id, v] of Object.entries(sessions)) {
      if (
        v &&
        typeof v === 'object' &&
        v.expiresAt > now &&
        v.auth &&
        v.sid &&
        v.baseUrl
      ) {
        let bu = String(v.baseUrl).trim().replace(/\/$/, '');
        if (!/^https?:\/\//i.test(bu)) bu = `https://${bu}`;
        const row = {
          auth: String(v.auth).trim(),
          sid: String(v.sid).trim(),
          baseUrl: bu,
          expiresAt: Number(v.expiresAt),
        };
        store.set(id, row);
        setExpiry(id, row.expiresAt);
      }
    }
    sidByNeo.clear();
    for (const [id, row] of store.entries()) {
      sidByNeo.set(row.sid, id);
    }
  } catch {
    /* corrupt or empty file */
  }
}

function removeSessionEntry(sessionId) {
  const row = store.get(sessionId);
  clearExpiry(sessionId);
  store.delete(sessionId);
  timers.delete(sessionId);
  if (row && sidByNeo.get(row.sid) === sessionId) {
    sidByNeo.delete(row.sid);
  }
  persistToDisk();
}

loadFromDisk();

/**
 * Create a session. Returns { sessionId, baseUrl }. Never returns auth/sid.
 * @param {{ auth: string, sid: string, baseUrl: string }} data
 * @returns {{ sessionId: string, baseUrl: string }}
 */
export function createSession(data) {
  if (!data?.auth || !data?.sid || !data?.baseUrl) {
    throw new Error('sessionStore: auth, sid, baseUrl required');
  }
  const auth = String(data.auth).trim();
  const sid = String(data.sid).trim();
  let baseUrl = String(data.baseUrl).trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `https://${baseUrl}`;
  if (!auth || !sid || !baseUrl) {
    throw new Error('sessionStore: auth, sid, baseUrl required after trim');
  }
  const sessionId = randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const prevId = sidByNeo.get(sid);
  if (prevId && prevId !== sessionId) {
    removeSessionEntry(prevId);
  }
  store.set(sessionId, {
    auth,
    sid,
    baseUrl,
    expiresAt,
  });
  sidByNeo.set(sid, sessionId);
  setExpiry(sessionId, expiresAt);
  persistToDisk();
  return { sessionId, baseUrl };
}

/**
 * Get session by id. Returns { auth, sid, baseUrl } or null.
 */
export function getSession(sessionId) {
  if (!sessionId) return null;
  const key = String(sessionId).trim();
  let id = key;
  let s = store.get(id);
  if (!s) {
    const byNeo = sidByNeo.get(key);
    if (byNeo) {
      id = byNeo;
      s = store.get(id);
    }
  }
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    removeSessionEntry(id);
    return null;
  }
  return { auth: s.auth, sid: s.sid, baseUrl: s.baseUrl };
}

export function deleteSession(sessionId) {
  if (!sessionId) return;
  const key = String(sessionId).trim();
  let id = key;
  if (!store.has(id)) {
    const byNeo = sidByNeo.get(key);
    if (byNeo) id = byNeo;
  }
  if (store.has(id)) removeSessionEntry(id);
}
