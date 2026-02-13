import { Router } from 'express';
import { BotEngine, BotState, BotEvents } from '../bot/BotEngine.js';
import { DataFeedEvents } from '../bot/DataFeed.js';
import { CandleBuilderEvents } from '../bot/CandleBuilder.js';
import { OrderExecutorEvents } from '../bot/OrderExecutor.js';
import { getSession } from '../sessionStore.js';
import { SessionExpiredError } from '../errors.js';
import {
  setSnapshotGetter,
  emitTick,
  emitCandle,
  emitSignal,
  emitPositionUpdate,
  emitBotStatus,
  emitCircuitBreaker,
} from '../socket.js';
import { recordOpen, recordClose } from '../tradeJournal.js';
import { ScannerService } from '../services/ScannerService.js';
import { logger } from '../logger.js';

const router = Router();

let engine = null;
const snapshot = {
  tick: null,
  candle: null,
  signal: null,
  positionUpdate: null,
  botStatus: null,
  circuitBreaker: null,
};

function clearSnapshot() {
  snapshot.tick = null;
  snapshot.candle = null;
  snapshot.signal = null;
  snapshot.positionUpdate = null;
  snapshot.botStatus = null;
  snapshot.circuitBreaker = null;
}

function wireEngineToSocket() {
  const dataFeed = engine.getDataFeed();
  const candleBuilder = engine.getCandleBuilder();
  const orderExecutor = engine.getOrderExecutor();

  if (dataFeed) {
    dataFeed.on(DataFeedEvents.CONNECTED, () => {
      logger.info('Bot', { msg: 'DataFeed connected to HSM' });
    });
    dataFeed.on(DataFeedEvents.ERROR, (err) => {
      logger.warn('Bot', { msg: 'DataFeed error', error: err?.message ?? String(err) });
    });
    dataFeed.on(DataFeedEvents.DISCONNECTED, () => {
      logger.info('Bot', { msg: 'DataFeed disconnected' });
    });
    let firstTickLogged = false;
    dataFeed.on(DataFeedEvents.TICK, (tick) => {
      if (!firstTickLogged) {
        logger.info('Bot', { msg: 'First tick received', hasLtp: tick?.ltp != null, instrumentToken: tick?.instrumentToken });
        firstTickLogged = true;
      }
      logger.info('Bot', { msg: 'Second tick received', hasLtp: tick?.ltp != null, instrumentToken: tick?.instrumentToken });

      snapshot.tick = tick;
      emitTick(tick);
    });
  }

  if (candleBuilder) {
    candleBuilder.on(CandleBuilderEvents.CANDLE, (candle) => {
      snapshot.candle = candle;
      emitCandle(candle);
    });
  }

  engine.on('signal', (payload) => {
    snapshot.signal = payload;
    emitSignal(payload);
  });

  if (orderExecutor) {
    orderExecutor.on(OrderExecutorEvents.POSITION_UPDATED, (data) => {
      snapshot.positionUpdate = data;
      emitPositionUpdate(data);
    });
  }

  snapshot.botStatus = { status: engine.getStatus() };
  emitBotStatus(snapshot.botStatus);

  engine.on(BotEvents.BOT_STARTED, () => {
    snapshot.botStatus = { status: BotState.RUNNING };
    emitBotStatus(snapshot.botStatus);
  });
  engine.on(BotEvents.BOT_STOPPED, () => {
    snapshot.botStatus = { status: BotState.STOPPED };
    emitBotStatus(snapshot.botStatus);
  });
  engine.on(BotEvents.BOT_ERROR, (err) => {
    snapshot.botStatus = { status: BotState.ERROR, error: err?.message ?? String(err) };
    emitBotStatus(snapshot.botStatus);
  });

  engine.on('circuitBreaker', (data) => {
    snapshot.circuitBreaker = data;
    emitCircuitBreaker(data);
  });

  engine.on('tradeOpened', (data) => {
    recordOpen(data).catch(() => {});
  });
  engine.on('tradeClosed', (data) => {
    recordClose(data).catch(() => {});
  });
}

router.post('/start', async (req, res) => {
  try {
    if (engine != null) {
      const status = engine.getStatus();
          if (status === BotState.RUNNING || status === BotState.STARTING) {
        return res.status(409).json({ error: 'Bot already running or starting' });
          }
      engine = null;
      clearSnapshot();
    }

    const { sessionId, instrumentToken, wsUrl, risk, instrument, strategies, strategyOptions } = req.body ?? {};
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    const session = getSession(sessionId);
    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid', code: 'SESSION_EXPIRED' });
    }
    if (instrumentToken == null || (Array.isArray(instrumentToken) && instrumentToken.length === 0)) {
      return res.status(400).json({ error: 'Missing instrumentToken' });
    }

    engine = new BotEngine({
      session,
      instrumentToken: Array.isArray(instrumentToken) ? instrumentToken : instrumentToken,
      wsUrl,
      risk,
      instrument,
      strategies: strategies ?? undefined,
      strategyOptions: strategyOptions ?? undefined,
    });

    await engine.start();
    wireEngineToSocket();
    setSnapshotGetter(() => (engine ? snapshot : null));

    logger.info('Bot started via API');
    res.json({ ok: true, status: engine.getStatus() });
  } catch (err) {
    const msg = err?.message ?? String(err);
    logger.error('Bot start failed', { error: msg });
    engine = null;
    clearSnapshot();
    setSnapshotGetter(null);
    res.status(502).json({ error: msg });
  }
});

router.post('/stop', async (req, res) => {
  try {
    if (engine == null) {
      return res.json({ ok: true, status: BotState.STOPPED });
    }
    await engine.stop();
    const status = engine.getStatus();
    engine = null;
    clearSnapshot();
    setSnapshotGetter(null);
    logger.info('Bot stopped via API');
    res.json({ ok: true, status });
  } catch (err) {
    const msg = err?.message ?? String(err);
    logger.error('Bot stop failed', { error: msg });
    res.status(502).json({ error: msg });
  }
});

router.get('/status', (req, res) => {
  const status = engine?.getStatus() ?? BotState.STOPPED;
  res.json({
    status,
    tick: snapshot.tick ?? undefined,
    candle: snapshot.candle ?? undefined,
    signal: snapshot.signal ?? undefined,
    positionUpdate: snapshot.positionUpdate ?? undefined,
  });
});

// --- Multi-Timeframe Scanner (does not use engine or live trading) ---

router.post('/scan', async (req, res) => {
  try {
    const { sessionId, watchlist } = req.body ?? {};
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }
    const session = getSession(sessionId);
    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid', code: 'SESSION_EXPIRED' });
    }
    const list = Array.isArray(watchlist) ? watchlist : [];
    const scanner = new ScannerService(session);
    const results = await scanner.scan(list);
    return res.json({ success: true, results });
  } catch (err) {
    const msg = err?.message ?? String(err);
    logger.error('Bot scan failed', { error: msg });
    res.status(502).json({ error: msg });
  }
});

/** For graceful shutdown: stop engine and clear state. */
export async function shutdownBot() {
  if (engine) {
    await engine.stop();
    engine = null;
    clearSnapshot();
    setSnapshotGetter(null);
  }
}

export default router;
