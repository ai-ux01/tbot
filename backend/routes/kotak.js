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

/** Consumer key from `Authorization` — raw UUID or `Bearer <uuid>` (Kotak Neo style). */
function getKotakConsumerKey(req) {
  const auth = req.headers.authorization;
  if (!auth || !String(auth).trim()) {
    throw new Error('Missing Authorization header (Kotak consumer key)');
  }
  let token = String(auth).trim();
  if (/^Bearer\s+/i.test(token)) {
    token = token.replace(/^Bearer\s+/i, '').trim();
  }
  if (!token || token === 'null' || token === 'undefined') {
    throw new Error('Access token (consumer key) is missing. Set it in step 1 of the login form.');
  }
  return token;
}

/** Resolve session from `x-session-id` header. Broker tokens stay server-side. */
function getSessionFromReq(req) {
  const raw = req.get('x-session-id');
  if (raw == null || String(raw).trim() === '') {
    throw new SessionExpiredError(
      'Missing x-session-id header. Send the sessionId from MPIN login as header x-session-id.',
    );
  }
  const sessionId = String(raw).split(',')[0].trim();
  const session = getSessionFromStore(sessionId);
  if (!session) {
    throw new SessionExpiredError(
      'Session expired or unknown. Log in with MPIN again (sessions persist to disk in non-production unless KOTAK_PERSIST_SESSIONS=0).',
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

/** Kotak `tradeApiValidate` wraps fields in `data`; normalize to that inner object. */
function neoMpinInnerPayload(body) {
  if (body?.data != null && typeof body.data === 'object' && !Array.isArray(body.data)) {
    return body.data;
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
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

function normalizeKotakBaseUrlHeader(v) {
  if (v == null || !String(v).trim()) return null;
  return String(v).replace(/\/$/, '').trim();
}

/** Neo JWT from `Auth` / `auth`, or `Authorization: Bearer <jwt>` when the bearer value looks like a JWT. */
function neoAuthFromOrderReq(req) {
  const direct = (req.get('Auth') ?? req.get('auth'))?.trim();
  if (direct) return direct;
  const az = req.get('authorization')?.trim();
  if (!az) return null;
  const rest = /^Bearer\s+/i.test(az) ? az.replace(/^Bearer\s+/i, '').trim() : az;
  return rest.startsWith('eyJ') ? rest : null;
}

/**
 * Order POSTs:
 * - Prefer server session: lookup by `x-session-id` (app id) or `Sid` (Neo sid or app id, via sessionStore).
 * - Stored row always supplies matching `auth` + Neo `sid` for Kotak.
 * - Else direct Neo: `Auth` + `Sid` (Neo) + base URL from `x-kotak-base-url` or `KOTAK_BASE_URL`.
 */
function resolveBrokerForOrderReq(req) {
  const envBase =
    process.env.KOTAK_BASE_URL && String(process.env.KOTAK_BASE_URL).trim()
      ? String(process.env.KOTAK_BASE_URL).replace(/\/$/, '')
      : null;
  const authHeader = neoAuthFromOrderReq(req);
  const sidHeader = (req.get('Sid') ?? req.get('sid'))?.trim();
  const xSession = req.get('x-session-id')?.split(',')[0]?.trim();

  let stored = null;
  if (xSession) stored = getSessionFromStore(xSession);
  if (!stored && sidHeader) stored = getSessionFromStore(sidHeader);

  if (stored) {
    const b = brokerFromStoredSession(stored);
    const baseUrl =
      normalizeKotakBaseUrlHeader(req.get('x-kotak-base-url')) ?? b.baseUrl ?? envBase;
    if (!baseUrl) {
      throw new SessionExpiredError(
        'Missing base URL: set x-kotak-base-url or KOTAK_BASE_URL, or re-login with MPIN.',
      );
    }
    if (!b.auth || !b.sid) {
      throw new SessionExpiredError('Stored session incomplete; run MPIN login again.');
    }
    return { auth: b.auth, sid: b.sid, baseUrl };
  }

  const baseUrl =
    normalizeKotakBaseUrlHeader(req.get('x-kotak-base-url')) ?? envBase;

  // Do not forward app session UUID as Kotak Sid when client also sent the same value as x-session-id
  // (misconfiguration). Otherwise allow direct Neo credentials without x-session-id.
  if (authHeader && sidHeader && baseUrl) {
    if (xSession && xSession === sidHeader) {
      throw new SessionExpiredError(
        'Broker session not found: Sid must be Kotak Neo sid, not the app session id. Run MPIN on this API or send Neo sid from tradeApiValidate.',
      );
    }
    return { auth: authHeader, sid: sidHeader, baseUrl };
  }

  throw new SessionExpiredError(
    'No broker session: complete MPIN on this server, or send Auth + Sid (Neo) + base URL (KOTAK_BASE_URL or x-kotak-base-url).',
  );
}

/** jData from JSON `{ jData }` or form field `jData=...`. */
function jDataFromOrderRequest(req) {
  const raw = req.body?.jData;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t === '' ? undefined : t;
  }
  return raw;
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

// --- Login (also mounted at POST /login/totp and /login/mpin on app root for legacy clients) ---

export async function loginTotpHandler(req, res) {
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
}

export async function loginMpinHandler(req, res) {
  try {
    const accessToken = getKotakConsumerKey(req);
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
    const inner = neoMpinInnerPayload(data);
    logger.info('login/mpin', { step: 'success' });
    res.json({ sessionId, data: inner });
  } catch (err) {
    const msg = typeof err?.message === 'string' ? err.message : (err ? String(err) : 'MPIN validate failed');
    logger.error('login/mpin', { error: msg });
    res.status(msg.includes('Missing') ? 400 : 502).json({
      error: msg,
    });
  }
}

router.post('/login/totp', loginTotpHandler);
router.post('/login/mpin', loginMpinHandler);

// --- Orders ---
router.post('/orders/place', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = resolveBrokerForOrderReq(req);
    const jData = jDataFromOrderRequest(req);
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
    const { auth, sid, baseUrl } = resolveBrokerForOrderReq(req);
    const jData = jDataFromOrderRequest(req);
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
    const { auth, sid, baseUrl } = resolveBrokerForOrderReq(req);
    const jData = jDataFromOrderRequest(req) ?? {};
    const data = await kotak.cancelOrder(baseUrl, auth, sid, jData);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/orders/exit-cover', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = resolveBrokerForOrderReq(req);
    const jData = jDataFromOrderRequest(req) ?? {};
    const data = await kotak.exitCover(baseUrl, auth, sid, jData);
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/orders/exit-bracket', async (req, res) => {
  try {
    const { auth, sid, baseUrl } = resolveBrokerForOrderReq(req);
    const jData = jDataFromOrderRequest(req) ?? {};
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
    const { auth, sid, baseUrl } = resolveBrokerForOrderReq(req);
    const jData = jDataFromOrderRequest(req) ?? {};
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
