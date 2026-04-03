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
  const raw = req.get('X-Session-Id');
  if (raw == null || String(raw).trim() === '') {
    throw new SessionExpiredError(
      'Missing X-Session-Id header. Send the sessionId from MPIN login as header X-Session-Id.',
    );
  }
  const sessionId = String(raw).split(',')[0].trim();
  const session = getSessionFromStore(sessionId);
  if (!session) {
    throw new SessionExpiredError(
      'Session expired or unknown. Log in with MPIN again (broker sessions live only in server memory and are lost when the API restarts).',
    );
  }
  return session;
}

/**
 * Parse Neo `tradeApiValidate` body: `data.token` (JWT for Auth header), `data.sid` (Sid header).
 */
function extractNeoTradeSessionFromMpinResponse(body) {
  const p =
    body?.data != null && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : body;
  const auth = p?.token ?? p?.accessToken;
  const sid = p?.sid;
  const envBase =
    process.env.KOTAK_BASE_URL && String(process.env.KOTAK_BASE_URL).trim()
      ? String(process.env.KOTAK_BASE_URL).replace(/\/$/, '')
      : null;
  const baseUrl = p?.baseUrl ?? p?.baseURL ?? envBase;
  return {
    auth: auth != null && String(auth).trim() ? String(auth).trim() : null,
    sid: sid != null && String(sid).trim() ? String(sid).trim() : null,
    baseUrl: baseUrl != null && String(baseUrl).trim() ? String(baseUrl).replace(/\/$/, '').trim() : null,
  };
}

/**
 * Stored session has `auth` (= Neo JWT) and `sid` (= Neo Sid). Do not use app session UUID as `sid`.
 */
function brokerFromStoredSession(session) {
  if (!session || typeof session !== 'object') {
    return { auth: null, sid: null, baseUrl: null };
  }
  const envBase =
    process.env.KOTAK_BASE_URL && String(process.env.KOTAK_BASE_URL).trim()
      ? String(process.env.KOTAK_BASE_URL).replace(/\/$/, '')
      : null;
  const auth = session.auth ?? session.token;
  const sid = session.sid;
  const baseUrl = session.baseUrl ?? envBase;
  return {
    auth: auth != null && String(auth).trim() ? String(auth).trim() : null,
    sid: sid != null && String(sid).trim() ? String(sid).trim() : null,
    baseUrl: baseUrl != null && String(baseUrl).trim() ? String(baseUrl).replace(/\/$/, '').trim() : null,
  };
}

function getBrokerSessionFromReq(req) {
  return brokerFromStoredSession(getSessionFromReq(req));
}

function sendError(res, err, defaultStatus = 502) {
  if (err instanceof SessionExpiredError) {
    return res.status(401).json({ error: err.message, code: err.code });
  }
  const msg = err?.message ?? String(err);
  const badRequest =
    msg.includes('Missing') ||
    msg.includes('jData must') ||
    msg.includes('jData is required');
  const status = badRequest ? 400 : defaultStatus;
  res.status(status).json({ error: msg });
}

/** Place/modify expect jData as object or JSON string (Neo payload). */
function assertOrderJDataPresent(jData) {
  if (jData === undefined || jData === null) {
    return { ok: false, error: 'Missing jData' };
  }
  if (typeof jData === 'string' && !jData.trim()) {
    return { ok: false, error: 'Missing jData' };
  }
  if (Array.isArray(jData)) {
    return { ok: false, error: 'jData must be a JSON object, not an array' };
  }
  return { ok: true };
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
    const { auth, sid, baseUrl } = extractNeoTradeSessionFromMpinResponse(data);
    if (!auth || !sid || !baseUrl) {
      logger.error('login/mpin', {
        reason: 'response missing token/sid/baseUrl',
        hasToken: !!auth,
        hasSid: !!sid,
        hasBaseUrl: !!baseUrl,
      });
      return res.status(502).json({
        error:
          'Invalid login response: need Neo token, sid, and baseUrl (set KOTAK_BASE_URL in .env if API omits baseUrl).',
      });
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
    const { auth, sid, baseUrl } = getBrokerSessionFromReq(req);
    console.log('auth???', auth);
    console.log('sid???', sid);
    console.log('baseUrl???', baseUrl);
    const jData = req.body?.jData;
    const check = assertOrderJDataPresent(jData);
    if (!check.ok) return res.status(400).json({ error: check.error });
    const data = await kotak.placeOrder(baseUrl, auth, sid, jData);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/orders/modify', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getBrokerSessionFromReq(req);
    const jData = req.body?.jData;
    const check = assertOrderJDataPresent(jData);
    if (!check.ok) return res.status(400).json({ error: check.error });
    const data = await kotak.modifyOrder(baseUrl, auth, sid, jData);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/orders/cancel', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getBrokerSessionFromReq(req);
    const jData = req.body?.jData ?? {};
    const data = await kotak.cancelOrder(baseUrl, auth, sid, jData);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/orders/exit-cover', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getBrokerSessionFromReq(req);
    const jData = req.body?.jData ?? {};
    const data = await kotak.exitCover(baseUrl, auth, sid, jData);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/orders/exit-bracket', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getBrokerSessionFromReq(req);
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
    const { auth, sid, baseUrl } = getBrokerSessionFromReq(req);
    const data = await kotak.getOrderBook(baseUrl, auth, sid);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/reports/order-history', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getBrokerSessionFromReq(req);
    const jData = req.body?.jData ?? {};
    const data = await kotak.orderHistory(baseUrl, auth, sid, jData);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/reports/trades', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getBrokerSessionFromReq(req);
    const data = await kotak.getTradeBook(baseUrl, auth, sid);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/reports/positions', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getBrokerSessionFromReq(req);
    const data = await kotak.getPositions(baseUrl, auth, sid);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/reports/holdings', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = getBrokerSessionFromReq(req);
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
