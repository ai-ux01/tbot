/**
 * Structured JSON logging. Never log tokens or secrets.
 * Output: one JSON object per line with timestamp, level, message, and optional meta.
 * Set LOG_LEVEL=debug|info|warn|error (default: info). Set LOG_FORMAT=pretty for readable dev output.
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;
const pretty = process.env.LOG_FORMAT?.toLowerCase() === 'pretty';

function sanitize(obj) {
  try {
    if (obj == null) return obj;
    if (typeof obj !== 'object') return obj;
    const out = {};
    const skip = new Set(['auth', 'sid', 'token', 'password', 'mpin', 'authorization', 'cookie']);
    for (const [k, v] of Object.entries(obj)) {
      const key = String(k).toLowerCase();
      if (skip.has(key) || key.includes('token') || key.includes('secret')) {
        out[k] = '[REDACTED]';
        continue;
      }
      out[k] = typeof v === 'object' && v !== null && !Array.isArray(v) ? sanitize(v) : v;
    }
    return out;
  } catch {
    return { _: '[serialization error]' };
  }
}

function log(level, message, meta = undefined) {
  try {
    const lvl = level && LOG_LEVELS[level] !== undefined ? level : 'info';
    if (LOG_LEVELS[lvl] < minLevel) return;
    const payload = {
      ts: new Date().toISOString(),
      level: (lvl || 'info').toUpperCase(),
      msg: message != null && typeof message === 'string' ? message : String(message ?? ''),
    };
    if (meta != null && typeof meta === 'object' && !Array.isArray(meta)) {
      payload.meta = sanitize(meta);
    } else if (meta != null) {
      payload.meta = sanitize({ value: meta });
    }
    const line = pretty
      ? `[${payload.ts}] ${payload.level} ${payload.msg}${payload.meta ? ' ' + JSON.stringify(payload.meta) : ''}`
      : JSON.stringify(payload);
    const out = lvl === 'error' ? process.stderr : process.stdout;
    out.write(line + '\n');
  } catch (err) {
    process.stderr.write(`[logger] failed to log: ${err?.message ?? err}\n`);
  }
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
