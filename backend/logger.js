/**
 * Structured JSON logging. Never log tokens or secrets.
 * Output: one JSON object per line with timestamp, level, message, and optional meta.
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;

function sanitize(obj) {
  if (obj == null) return obj;
  if (typeof obj !== 'object') return obj;
  const out = {};
  const skip = new Set(['auth', 'sid', 'token', 'password', 'mpin', 'authorization', 'cookie']);
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase();
    if (skip.has(key) || key.includes('token') || key.includes('secret')) {
      out[k] = '[REDACTED]';
      continue;
    }
    out[k] = typeof v === 'object' && v !== null && !Array.isArray(v) ? sanitize(v) : v;
  }
  return out;
}

function log(level, message, meta = undefined) {
  if (LOG_LEVELS[level] < minLevel) return;
  const payload = {
    ts: new Date().toISOString(),
    level: level.toUpperCase(),
    msg: typeof message === 'string' ? message : String(message),
  };
  if (meta != null && typeof meta === 'object' && !Array.isArray(meta)) {
    payload.meta = sanitize(meta);
  } else if (meta != null) {
    payload.meta = sanitize({ value: meta });
  }
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info(message, meta) {
    log('info', message, meta);
  },
  warn(message, meta) {
    log('warn', message, meta);
  },
  error(message, meta) {
    log('error', message, meta);
  },
  debug(message, meta) {
    log('debug', message, meta);
  },
};
