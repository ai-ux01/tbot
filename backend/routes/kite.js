/**
 * Zerodha Kite Connect routes: login URL, callback (token exchange), profile, margins, logout.
 * api_secret and access_token never sent to client.
 */

import { Router } from 'express';
import {
  getLoginUrl,
  exchangeToken,
  getUserProfile,
  getUserMargins,
  getUserMarginsSegment,
  getInstruments,
} from '../services/kiteApi.js';
import { getHistoricalCandles } from '../services/kiteHistorical.js';
import { syncNseEquityHistorical } from '../services/KiteNseHistoricalSync.js';
import { setKiteSession, getKiteSession, removeKiteSession } from '../kiteSessionStore.js';
import { logger } from '../logger.js';
import { Candle } from '../database/models/Candle.js';
import { isDbConnected } from '../database/connection.js';

const router = Router();
const API_KEY = process.env.KITE_API_KEY;
const API_SECRET = process.env.KITE_API_SECRET;
const REDIRECT_URI = process.env.KITE_REDIRECT_URI;

/** Compute last RSI value (Wilder) from array of closes (oldest first). Returns number or null. */
function computeRsiFromCloses(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let j = 1; j <= period; j++) {
    const ch = closes[j] - closes[j - 1];
    if (ch > 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  let lastRsi = null;
  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const ch = closes[i] - closes[i - 1];
      const g = ch > 0 ? ch : 0;
      const l = ch < 0 ? -ch : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
    }
    const rs = avgLoss === 0 ? (avgGain > 0 ? Infinity : 1) : avgGain / avgLoss;
    lastRsi = avgLoss === 0 && avgGain === 0 ? 50 : (avgGain === 0 ? 0 : 100 - 100 / (1 + rs));
  }
  return lastRsi != null ? Math.min(100, Math.max(0, lastRsi)) : null;
}
const FRONTEND_URL = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:5173';

if (!API_KEY || !API_SECRET) {
  logger.warn('Kite routes', { msg: 'KITE_API_KEY or KITE_API_SECRET not set' });
}

/**
 * GET /api/kite/stored-candles/summary
 * Returns aggregate counts of stored candles (no Kite session required).
 * Defined early so it is not shadowed by any param route.
 */
router.get('/stored-candles/summary', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected', hint: 'Set MONGODB_URI in backend/.env' });
  }
  try {
    const [totalCandles, byTimeframe, symbolCount, sampleSymbols, symbolsList] = await Promise.all([
      Candle.countDocuments(),
      Candle.aggregate([{ $group: { _id: '$timeframe', count: { $sum: 1 } } }]).then((rows) =>
        Object.fromEntries((rows || []).map((r) => [r._id, r.count]))
      ),
      Candle.distinct('symbol').then((s) => (Array.isArray(s) ? s.length : 0)),
      Candle.aggregate([
        { $group: { _id: { symbol: '$symbol', timeframe: '$timeframe' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]).then((rows) => rows || []),
      Candle.aggregate([
        { $group: { _id: '$symbol', tradingsymbol: { $first: '$tradingsymbol' } } },
        { $sort: { _id: 1 } },
        { $project: { symbol: '$_id', tradingsymbol: 1, _id: 0 } },
      ]).then((rows) => rows || []),
    ]);
    res.json({
      totalCandles,
      byTimeframe: byTimeframe || {},
      symbolCount,
      symbols: symbolsList,
      sampleSymbols: sampleSymbols.map((r) => ({
        symbol: r._id?.symbol,
        timeframe: r._id?.timeframe,
        count: r.count,
      })),
    });
  } catch (err) {
    logger.error('Stored candles summary failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Summary failed' });
  }
});

/**
 * GET /api/kite/stored-candles/symbols-rsi?timeframe=day&period=14
 * Returns [{ symbol, tradingsymbol, rsi }] for each symbol (RSI from last candles). No Kite session.
 */
router.get('/stored-candles/symbols-rsi', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected', hint: 'Set MONGODB_URI in backend/.env' });
  }
  const timeframe = (req.query.timeframe || 'day').trim();
  const period = Math.min(30, Math.max(2, parseInt(req.query.period, 10) || 14));
  const needed = period + 1;
  try {
    const rows = await Candle.aggregate([
      { $match: { timeframe } },
      { $sort: { time: -1 } },
      {
        $group: {
          _id: '$symbol',
          tradingsymbol: { $first: '$tradingsymbol' },
          closes: { $push: '$close' },
        },
      },
      { $project: { symbol: '$_id', tradingsymbol: 1, closes: { $slice: ['$closes', needed] } } },
    ]);
    const out = [];
    for (const r of rows || []) {
      const closes = (r.closes || []).reverse();
      const rsi = computeRsiFromCloses(closes, period);
      out.push({
        symbol: r.symbol ?? r._id,
        tradingsymbol: r.tradingsymbol ?? null,
        rsi: rsi != null ? Math.round(rsi * 100) / 100 : null,
      });
    }
    res.json({ symbols: out, timeframe, period });
  } catch (err) {
    logger.error('Stored candles symbols-rsi failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'symbols-rsi failed' });
  }
});

/**
 * POST /api/kite/stored-candles/delete-by-tradingsymbols
 * Body: { tradingsymbols: string[] } — delete all candles whose tradingsymbol is in the list.
 */
router.post('/stored-candles/delete-by-tradingsymbols', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected', hint: 'Set MONGODB_URI in backend/.env' });
  }
  const list = req.body?.tradingsymbols;
  const tradingsymbols = Array.isArray(list)
    ? list.map((s) => String(s).trim()).filter(Boolean)
    : [];
  if (tradingsymbols.length === 0) {
    return res.status(400).json({ error: 'Body must include tradingsymbols: string[]' });
  }
  try {
    const result = await Candle.deleteMany({ tradingsymbol: { $in: tradingsymbols } });
    const deleted = result.deletedCount ?? 0;
    logger.info('Stored candles delete-by-tradingsymbols', { count: tradingsymbols.length, deleted });
    res.json({ ok: true, deleted, tradingsymbols });
  } catch (err) {
    logger.error('Stored candles delete-by-tradingsymbols failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Delete failed' });
  }
});

/**
 * GET /api/kite/stored-candles?symbol=&tradingsymbol=&timeframe=&limit=
 * Returns stored candles. Use symbol (instrument token) or tradingsymbol (e.g. RELIANCE).
 */
router.get('/stored-candles', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected', hint: 'Set MONGODB_URI in backend/.env' });
  }
  try {
    const symbol = (req.query.symbol || '').trim();
    const tradingsymbol = (req.query.tradingsymbol || '').trim();
    const timeframe = (req.query.timeframe || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 5000);
    const filter = {};
    if (symbol) filter.symbol = symbol;
    if (tradingsymbol) filter.tradingsymbol = new RegExp(`^${tradingsymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if (timeframe) filter.timeframe = timeframe;
    const candles = await Candle.find(filter).sort({ time: -1 }).limit(limit).lean();
    res.json({ candles });
  } catch (err) {
    logger.error('Stored candles query failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Query failed' });
  }
});

/**
 * DELETE /api/kite/stored-candles/keep-only?tradingsymbol=RELIANCE
 * Deletes all candles whose tradingsymbol is not the given value. Use to keep only one symbol.
 */
router.delete('/stored-candles/keep-only', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected', hint: 'Set MONGODB_URI in backend/.env' });
  }
  const keep = (req.query.tradingsymbol || '').trim();
  if (!keep) {
    return res.status(400).json({ error: 'Query param tradingsymbol is required (e.g. ?tradingsymbol=RELIANCE)' });
  }
  try {
    const result = await Candle.deleteMany({
      $or: [
        { tradingsymbol: { $ne: keep } },
        { tradingsymbol: { $exists: false } },
        { tradingsymbol: null },
      ],
    });
    const deleted = result.deletedCount ?? 0;
    logger.info('Stored candles keep-only', { keep, deleted });
    res.json({ ok: true, kept: keep, deleted });
  } catch (err) {
    logger.error('Stored candles keep-only failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Delete failed' });
  }
});

/**
 * GET /api/kite/login-url
 * Query: redirect_params (optional JSON string, e.g. {"userId":"abc"})
 * Returns: { loginUrl } for client to redirect user to Kite login.
 */
router.get('/login-url', (req, res) => {
  if (!API_KEY || !API_SECRET) {
    return res.status(503).json({
      error: 'Kite not configured',
      hint: 'Set KITE_API_KEY and KITE_API_SECRET in backend .env (see .env.example)',
    });
  }
  let redirectParams = {};
  logger.info('Login URL', { redirectParams: req.query.redirect_params });
  try {
    if (req.query.redirect_params && typeof req.query.redirect_params === 'string') {
      redirectParams = JSON.parse(req.query.redirect_params);
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid redirect_params' });
  }
  const loginUrl = getLoginUrl(API_KEY, REDIRECT_URI, redirectParams);
  res.json({ loginUrl });
});

/**
 * POST /api/kite/complete-login
 * When Kite redirects to the frontend (wrong redirect_uri), frontend sends request_token here.
 * Backend exchanges, creates session, returns { kite_sid } so frontend can store and use X-Kite-Session-Id.
 */
router.post('/complete-login', async (req, res) => {

  if (!API_KEY || !API_SECRET) {
    return res.status(503).json({ error: 'Kite not configured' });
  }
  const requestToken = req.body?.request_token;
  if (!requestToken || typeof requestToken !== 'string') {
    return res.status(400).json({ error: 'request_token required' });
  }
  try {
    const data = await exchangeToken(API_KEY, API_SECRET, requestToken.trim());
    const accessToken = data?.data?.access_token ?? data?.access_token;
    if (!accessToken) {
      logger.warn('Kite complete-login: no access_token in response', {
        status: data?.status,
        hasData: !!data?.data,
        dataKeys: data?.data ? Object.keys(data.data) : [],
      });
      const msg = data?.data?.message || data?.message || 'Token exchange failed';
      return res.status(400).json({ error: msg });
    }
    const sessionId = `kite_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    setKiteSession(sessionId, {
      accessToken,
      apiKey: API_KEY,
      loginTime: Date.now(),
      redirectParams: null,
    });
    res.json({ kite_sid: sessionId });
  } catch (err) {
    logger.error('Kite complete-login failed', { error: err?.message });
    const raw = err?.message ?? 'Exchange failed';
    const safe =
      /status code \d{3}/i.test(raw) || raw.startsWith('Request failed')
        ? 'Token exchange failed. Check KITE_API_SECRET and that the request_token is from a fresh Kite login (redirect URL: http://localhost:4000/api/kite/callback).'
        : raw;
    res.status(400).json({ error: safe });
  }
});

/**
 * GET /api/kite/callback
 * Kite redirects here after login with ?request_token=...&action=login&status=success
 * Exchange request_token for access_token; store server-side; redirect to frontend.
 */
router.get('/callback', async (req, res) => {
  const requestToken = req.query.request_token;
  const status = req.query.status;
  const action = req.query.action;

  if (!requestToken || status !== 'success' || action !== 'login') {
    logger.warn('Kite callback', { status, action, hasToken: !!requestToken });
    return res.redirect(`${FRONTEND_URL}?kite=error`);
  }
  if (!API_KEY || !API_SECRET) {
    return res.redirect(`${FRONTEND_URL}?kite=config_error`);
  }
  try {
    const data = await exchangeToken(API_KEY, API_SECRET, requestToken);
    const accessToken = data?.data?.access_token ?? data?.access_token;
    if (!accessToken) {
      logger.warn('Kite callback: no access_token in response', {
        status: data?.status,
        hasData: !!data?.data,
        dataKeys: data?.data ? Object.keys(data.data) : [],
      });
      const reason = data?.data?.message || data?.message || 'no_token';
      return res.redirect(`${FRONTEND_URL}?kite=exchange_failed&reason=${encodeURIComponent(reason)}`);
    }
    const sessionId = req.query.state || `kite_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    let redirectParams = null;
    try {
      if (req.query.redirect_params && typeof req.query.redirect_params === 'string') {
        redirectParams = JSON.parse(req.query.redirect_params);
      }
    } catch (_) {}
    setKiteSession(sessionId, {
      accessToken,
      apiKey: API_KEY,
      loginTime: Date.now(),
      redirectParams,
    });
    res.cookie('kite_session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    // Pass session id in URL so frontend can send X-Kite-Session-Id (cross-origin cookie often not sent)
    const frontendUrl = new URL(FRONTEND_URL);
    frontendUrl.searchParams.set('kite', 'success');
    frontendUrl.searchParams.set('kite_sid', sessionId);
    res.redirect(frontendUrl.toString());
  } catch (err) {
    logger.error('Kite token exchange failed', { error: err?.message });
    const reason = err?.message ? encodeURIComponent(err.message) : '';
    res.redirect(`${FRONTEND_URL}?kite=exchange_failed${reason ? `&reason=${reason}` : ''}`);
  }
});

/**
 * Middleware: require Kite session (cookie kite_session_id or header X-Kite-Session-Id).
 */
function requireKiteSession(req, res, next) {
  const rawId = req.cookies?.kite_session_id || req.get('X-Kite-Session-Id');
  const sessionId = rawId ? String(rawId).trim() : null;
  const session = sessionId ? getKiteSession(sessionId) : null;
  if (!session?.accessToken) {
    return res.status(401).json({
      error: sessionId ? 'Kite session expired or invalid' : 'Kite session required',
      code: 'KITE_SESSION_EXPIRED',
    });
  }
  req.kiteSession = session;
  req.kiteSessionId = sessionId;
  next();
}

/**
 * GET /api/kite/profile
 */
router.get('/profile', requireKiteSession, async (req, res) => {
  try {
    const profile = await getUserProfile(req.kiteSession.accessToken, req.kiteSession.apiKey);
    res.json(profile);
  } catch (err) {
    if (err.response?.status === 401) {
      removeKiteSession(req.kiteSessionId);
      return res.status(401).json({ error: 'Kite token invalid', code: 'KITE_SESSION_EXPIRED' });
    }
    res.status(502).json({ error: err?.message ?? 'Profile fetch failed' });
  }
});

/**
 * GET /api/kite/margins
 */
router.get('/margins', requireKiteSession, async (req, res) => {
  try {
    const data = await getUserMargins(req.kiteSession.accessToken, req.kiteSession.apiKey);
    res.json(data);
  } catch (err) {
    if (err.response?.status === 401) {
      removeKiteSession(req.kiteSessionId);
      return res.status(401).json({ error: 'Kite token invalid', code: 'KITE_SESSION_EXPIRED' });
    }
    res.status(502).json({ error: err?.message ?? 'Margins fetch failed' });
  }
});

/**
 * GET /api/kite/margins/:segment
 */
router.get('/margins/:segment', requireKiteSession, async (req, res) => {
  try {
    const data = await getUserMarginsSegment(
      req.kiteSession.accessToken,
      req.params.segment,
      req.kiteSession.apiKey,
    );
    res.json(data);
  } catch (err) {
    if (err.response?.status === 401) {
      removeKiteSession(req.kiteSessionId);
      return res.status(401).json({ error: 'Kite token invalid', code: 'KITE_SESSION_EXPIRED' });
    }
    res.status(502).json({ error: err?.message ?? 'Margins fetch failed' });
  }
});

/**
 * GET /api/kite/instruments
 * GET /api/kite/instruments/:exchange
 * Returns { instruments: Array<{ instrument_token, tradingsymbol, name, exchange, ... }> }
 */
router.get('/instruments/:exchange?', requireKiteSession, async (req, res) => {
  try {
    const exchange = req.params.exchange || null;
    const data = await getInstruments(
      req.kiteSession.accessToken,
      req.kiteSession.apiKey,
      exchange,
    );
    res.json(data);
  } catch (err) {
    if (err.response?.status === 401) {
      removeKiteSession(req.kiteSessionId);
      return res.status(401).json({ error: 'Kite token invalid', code: 'KITE_SESSION_EXPIRED' });
    }
    res.status(502).json({ error: err?.message ?? 'Instruments fetch failed' });
  }
});

/**
 * POST /api/kite/historical
 * Body: { instrumentToken, interval, from, to, options?: { continuous?: 0|1, oi?: 0|1 } }
 * Returns: { candles: Array<{ timestamp, open, high, low, close, volume, oi? }> }
 * Uses API_KEY from env and accessToken from session; neither sent to client.
 */
router.post('/historical', requireKiteSession, async (req, res) => {
  if (!API_KEY) {
    return res.status(503).json({ error: 'Kite not configured' });
  }
  try {
    const { instrumentToken, interval, from, to, options = {} } = req.body ?? {};
    const candles = await getHistoricalCandles({
      apiKey: API_KEY,
      accessToken: req.kiteSession.accessToken,
      instrumentToken,
      interval,
      from,
      to,
      options: { continuous: options.continuous ?? 0, oi: options.oi ?? 0 },
    });
    res.json({ candles });
  } catch (err) {
    if (err.message === 'Kite session expired or invalid') {
      removeKiteSession(req.kiteSessionId);
      return res.status(401).json({ error: err.message, code: 'KITE_SESSION_EXPIRED' });
    }
    res.status(400).json({ error: err.message ?? 'Historical fetch failed' });
  }
});

/**
 * POST /api/kite/sync-nse-historical
 * Syncs NSE equity 1h + 1d candles for last 5 years to DB. Body: { limit?: number } to cap instruments (for testing).
 * Long-running; ensure MONGODB_URI is set.
 */
router.all('/sync-nse-historical', (req, res, next) => {
  if (req.method !== 'POST') return res.set('Allow', 'POST').status(405).json({ error: 'Method not allowed' });
  next();
});
router.post('/sync-nse-historical', requireKiteSession, async (req, res) => {
  if (!req.kiteSession.apiKey) {
    return res.status(400).json({ error: 'Session missing apiKey' });
  }
  try {
    const session = {
      accessToken: req.kiteSession.accessToken,
      apiKey: req.kiteSession.apiKey,
    };
    const opts = {};
    if (req.body?.limit != null) opts.limit = req.body.limit;
    if (req.body?.instrument_token != null) opts.instrument_token = req.body.instrument_token;
    if (req.body?.tradingsymbol != null) opts.tradingsymbol = req.body.tradingsymbol;
    const result = await syncNseEquityHistorical(session, opts);
    logger.info('KiteNseHistoricalSync done', result);
    res.json({
      ok: true,
      message: 'NSE equity historical sync (1h + 1d, last 5 years) completed',
      ...result,
    });
  } catch (err) {
    if (err.response?.status === 401) {
      removeKiteSession(req.kiteSessionId);
      return res.status(401).json({ error: 'Kite token invalid', code: 'KITE_SESSION_EXPIRED' });
    }
    logger.error('KiteNseHistoricalSync failed', { error: err?.message });
    res.status(502).json({ error: err?.message ?? 'Sync failed' });
  }
});

/**
 * POST /api/kite/logout
 * Invalidates server-side Kite session and clears cookie.
 */
router.post('/logout', (req, res) => {
  const sessionId = req.cookies?.kite_session_id || req.get('X-Kite-Session-Id');
  if (sessionId) removeKiteSession(sessionId);
  res.clearCookie('kite_session_id');
  res.json({ ok: true });
});

export default router;
