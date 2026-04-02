/**
 * Persist full backtest HTTP responses to MongoDB (`BacktestRun`).
 */

import { isDbConnected } from '../database/connection.js';
import { BacktestRun } from '../database/models/BacktestRun.js';
import { logger } from '../logger.js';

/** Stay under BSON ~16MB; leave margin for metadata. */
const MAX_JSON_CHARS = 14_000_000;

/**
 * @param {import('express').Request} req
 * @returns {{ query: object, body: object }}
 */
export function sanitizeBacktestRequest(req) {
  const query = req.query && typeof req.query === 'object' && !Array.isArray(req.query) ? { ...req.query } : {};
  let body = {};
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    body = { ...req.body };
    if (Array.isArray(body.candles)) {
      body._candlesLength = body.candles.length;
      delete body.candles;
    }
  }
  return { query, body };
}

function jsonSize(obj) {
  try {
    return JSON.stringify(obj).length;
  } catch {
    return Infinity;
  }
}

function stripTradesDeep(value) {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map(stripTradesDeep);
  }
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'trades' && Array.isArray(v)) {
      out.tradesOmittedCount = v.length;
      continue;
    }
    out[k] = stripTradesDeep(v);
  }
  return out;
}

function shrinkForMongo(response) {
  let r = response;
  let truncated = false;
  const notes = [];

  if (jsonSize(r) <= MAX_JSON_CHARS) {
    return { response: r, truncated: false, truncationNote: null };
  }

  r = stripTradesDeep(JSON.parse(JSON.stringify(r)));
  truncated = true;
  notes.push('Omitted nested `trades` arrays (counts in tradesOmittedCount) to fit MongoDB limit.');

  if (jsonSize(r) <= MAX_JSON_CHARS) {
    return { response: r, truncated, truncationNote: notes.join(' ') };
  }

  if (Array.isArray(r.results) && r.results.length > 100) {
    const total = r.results.length;
    r = {
      ...r,
      results: r.results.slice(0, 100),
      _resultsTruncatedFrom: total,
    };
    notes.push(`results[] truncated to 100 of ${total}.`);
  }

  if (jsonSize(r) > MAX_JSON_CHARS && r.equityCurve) {
    const { equityCurve, ...rest } = r;
    r = { ...rest, equityCurveOmitted: true, equityCurveLength: Array.isArray(equityCurve) ? equityCurve.length : 0 };
    notes.push('Removed equityCurve.');
  }

  if (jsonSize(r) > MAX_JSON_CHARS) {
    r = {
      summary: r.summary ?? null,
      error: r.error ?? null,
      symbol: r.symbol ?? null,
      _storedSummaryOnly: true,
      _note: 'Response too large; only summary/symbol fields kept.',
    };
    notes.push('Stored summary-only fallback.');
  }

  return {
    response: r,
    truncated: true,
    truncationNote: notes.join(' '),
  };
}

/**
 * @param {object} o
 * @param {string} o.route - e.g. `POST /api/signals/rsi-ma-setup-copy/backtest`
 * @param {string} [o.method]
 * @param {object|null} [o.params] - use sanitizeBacktestRequest(req)
 * @param {object} o.response - successful JSON body (not error responses)
 */
export async function persistBacktestRun(o) {
  if (!isDbConnected() || !o?.response || typeof o.response !== 'object') return null;
  const route = String(o.route || '').trim().slice(0, 240);
  if (!route) return null;

  const { response: resp, truncated, truncationNote } = shrinkForMongo(o.response);

  try {
    const doc = await BacktestRun.create({
      route,
      method: String(o.method || 'GET').toUpperCase().slice(0, 12),
      params: o.params != null ? o.params : undefined,
      response: resp,
      truncated,
      truncationNote,
    });
    return doc.toObject();
  } catch (err) {
    logger.error('backtestRunPersistence: save failed', { route, error: err?.message });
    return null;
  }
}

/**
 * @param {{ limit?: number, skip?: number }} [q]
 */
export async function listBacktestRuns(q = {}) {
  if (!isDbConnected()) return { runs: [], total: 0, limit: 0, skip: 0 };
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const skip = Math.max(0, Number(q.skip) || 0);
  const [runs, total] = await Promise.all([
    BacktestRun.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    BacktestRun.countDocuments(),
  ]);
  return { runs, total, limit, skip };
}
