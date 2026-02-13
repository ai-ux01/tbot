import { Router } from 'express';
import * as kotak from '../services/kotakApi.js';
import { logger } from '../logger.js';
import { getSession as getSessionFromStore, createSession } from '../sessionStore.js';
import { SessionExpiredError } from '../errors.js';

const router = Router();

function getAccessToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header (Bearer <access_token>)');
  }
  const token = auth.slice(7).trim();
  if (!token || token === 'null' || token === 'undefined') {
    throw new Error('Access token (consumer key) is missing. Set it in step 1 of the login form.');
  }
  return token;
}

/** Resolve session from X-Session-Id header. Broker tokens stay server-side. */
function getSessionFromReq(req) {
  const sessionId = req.headers['x-session-id'] ?? req.headers['X-Session-Id'];
  if (!sessionId) throw new SessionExpiredError('Missing X-Session-Id header');
  const session = getSessionFromStore(sessionId);
  if (!session) throw new SessionExpiredError('Session expired or invalid');
  return session;
}

function sendError(res, err, defaultStatus = 502) {
  if (err instanceof SessionExpiredError) {
    return res.status(401).json({ error: err.message, code: err.code });
  }
  const status = err.message?.includes('Missing') ? 400 : defaultStatus;
  res.status(status).json({ error: err?.message ?? String(err) });
}

// --- Login ---

router.post('/login/totp', async (req, res) => {
  try {
    const accessToken = getAccessToken(req);
    const { mobileNumber, ucc, totp } = req.body || {};
    if (!mobileNumber || !ucc || !totp) {
      logger.warn('login/totp', { reason: 'missing body fields' });
      return res.status(400).json({ error: 'Missing mobileNumber, ucc, or totp' });
    }
    logger.info('login/totp', { hasMobile: !!mobileNumber, hasUcc: !!ucc });
    const data = await kotak.totpLogin(accessToken, { mobileNumber, ucc, totp });
    logger.info('login/totp', { step: 'success' });
    res.json(data);
  } catch (err) {
    const msg = typeof err?.message === 'string' ? err.message : (err ? String(err) : 'TOTP login failed');
    logger.error('login/totp', { error: msg });
    res.status(msg.includes('Missing') ? 400 : 502).json({
      error: msg,
    });
  }
});

router.post('/login/mpin', async (req, res) => {
  try {
    const accessToken = getAccessToken(req);
    const viewSid = req.headers.sid;
    const viewToken = req.headers.auth;
    const { mpin } = req.body || {};
    if (!viewSid || !viewToken || !mpin) {
      logger.warn('login/mpin', { reason: 'missing sid, auth, or mpin' });
      return res.status(400).json({ error: 'Missing sid, auth (viewToken), or mpin' });
    }
    logger.info('login/mpin', { step: 'validating' });
    const data = await kotak.mpinValidate(accessToken, viewSid, viewToken, mpin);
    const auth = data?.data?.token ?? data?.token;
    const sid = data?.data?.sid ?? data?.sid;
    const baseUrl = data?.data?.baseUrl ?? data?.baseUrl;
    if (!auth || !sid || !baseUrl) {
      logger.error('login/mpin', { reason: 'response missing auth/sid/baseUrl' });
      return res.status(502).json({ error: 'Invalid login response' });
    }
    const { sessionId } = createSession({ auth, sid, baseUrl });
    logger.info('login/mpin', { step: 'success' });
    res.json({ sessionId, baseUrl });
  } catch (err) {
    const msg = typeof err?.message === 'string' ? err.message : (err ? String(err) : 'MPIN validate failed');
    logger.error('login/mpin', { error: msg });
    res.status(msg.includes('Missing') ? 400 : 502).json({
      error: msg,
    });
  }
});

// --- Orders ---

router.post('/orders/place', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getSessionFromReq(req);
    const jData = req.body?.jData;
    if (!jData) return res.status(400).json({ error: 'Missing jData' });
    const data = await kotak.placeOrder(baseUrl, auth, sid, jData);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/orders/modify', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getSessionFromReq(req);
    const jData = req.body?.jData;
    if (!jData) return res.status(400).json({ error: 'Missing jData' });
    const data = await kotak.modifyOrder(baseUrl, auth, sid, jData);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/orders/cancel', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getSessionFromReq(req);
    const jData = req.body?.jData ?? {};
    const data = await kotak.cancelOrder(baseUrl, auth, sid, jData);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/orders/exit-cover', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getSessionFromReq(req);
    const jData = req.body?.jData ?? {};
    const data = await kotak.exitCover(baseUrl, auth, sid, jData);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/orders/exit-bracket', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getSessionFromReq(req);
    const jData = req.body?.jData ?? {};
    const data = await kotak.exitBracket(baseUrl, auth, sid, jData);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

// --- Reports ---

router.get('/reports/orders', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getSessionFromReq(req);
    const data = await kotak.getOrderBook(baseUrl, auth, sid);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/reports/order-history', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getSessionFromReq(req);
    const jData = req.body?.jData ?? {};
    const data = await kotak.orderHistory(baseUrl, auth, sid, jData);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/reports/trades', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getSessionFromReq(req);
    const data = await kotak.getTradeBook(baseUrl, auth, sid);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/reports/positions', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getSessionFromReq(req);
    const data = await kotak.getPositions(baseUrl, auth, sid);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/reports/holdings', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getSessionFromReq(req);
    const data = await kotak.getHoldings(baseUrl, auth, sid);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

// --- Quotes (only Authorization) ---

router.get('/quotes', async (req, res) => {
  try {
    const accessToken = getAccessToken(req);
    const { baseUrl, exchangeSegment = 'nse_cm', symbol } = req.query;
    if (!baseUrl || !symbol) {
      return res.status(400).json({ error: 'Missing baseUrl or symbol query' });
    }
    const data = await kotak.getQuotes(baseUrl, accessToken, exchangeSegment, symbol);
    res.json(data);
  } catch (err) {
    res.status(err.message?.includes('Missing') ? 400 : 502).json({ error: err.message });
  }
});

router.get('/scripmaster/file-paths', async (req, res) => {
  try {
    const accessToken = getAccessToken(req);
    const { baseUrl } = req.query;
    if (!baseUrl) return res.status(400).json({ error: 'Missing baseUrl query' });
    const data = await kotak.getScripmasterPaths(baseUrl, accessToken);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
