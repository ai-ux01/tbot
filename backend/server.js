import http from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { config } from './config.js';
import kotakRoutes from './routes/kotak.js';
import botRoutes from './routes/bot.js';
import swingRoutes from './routes/swing.js';
import kiteRoutes from './routes/kite.js';
import tradesRoutes from './routes/trades.js';
import backtestRoutes from './routes/backtest.js';
import signalsRoutes from './routes/signals.js';
import paperTradingRoutes from './routes/paperTrading.js';
import { logger } from './logger.js';
import { setIO } from './socket.js';
import { connectDb, disconnectDb } from './database/connection.js';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: config.corsOrigin, methods: ['GET', 'POST'] },
});
setIO(io);

app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Auth', 'Sid', 'X-Session-Id', 'X-Kite-Session-Id', 'neo-fin-key'],
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

// Request logging: structured (no tokens logged)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('request', { method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: duration });
  });
  next();
});

// Explicit preflight for login so cross-origin POST from 5173 always succeeds
app.options('/api/kotak/login/totp', (_, res) => res.sendStatus(204));
app.options('/api/kotak/login/mpin', (_, res) => res.sendStatus(204));
app.options('/api/kite/sync-nse-historical', (_, res) => res.set('Allow', 'POST').sendStatus(204));
app.options('/api/kite/stored-candles', (_, res) => res.set('Allow', 'GET').sendStatus(204));
app.options('/api/kite/stored-candles/summary', (_, res) => res.set('Allow', 'GET').sendStatus(204));
app.options('/api/kite/stored-candles/symbols', (_, res) => res.set('Allow', 'GET').sendStatus(204));
app.options('/api/kite/stored-candles/push', (_, res) => res.set('Allow', 'POST').sendStatus(204));
app.options('/api/kite/stored-candles/keep-only', (_, res) => res.set('Allow', 'DELETE').sendStatus(204));
app.options('/api/kite/stored-candles/delete-by-tradingsymbols', (_, res) => res.set('Allow', 'POST').sendStatus(204));
app.options('/api/signals', (_, res) => res.set('Allow', 'GET, POST').sendStatus(204));
app.options('/api/signals/evaluate', (_, res) => res.set('Allow', 'POST').sendStatus(204));
app.options('/api/signals/evaluate-all', (_, res) => res.set('Allow', 'POST').sendStatus(204));
app.options('/api/signals/combined', (_, res) => res.set('Allow', 'GET').sendStatus(204));
app.options('/api/signals/rsi-setup', (_, res) => res.set('Allow', 'GET').sendStatus(204));
app.options('/api/signals/rsi-setup/combined', (_, res) => res.set('Allow', 'GET').sendStatus(204));
app.options('/api/signals/rsi-setup/backtest', (_, res) => res.set('Allow', 'POST').sendStatus(204));
app.options('/api/signals/train', (_, res) => res.set('Allow', 'POST').sendStatus(204));

app.use('/api/kotak', kotakRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/swing', swingRoutes);
app.use('/api/kite', kiteRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/signals', signalsRoutes);
app.use('/api/paper-trading', paperTradingRoutes);

app.get('/health', (_, res) => res.json({ ok: true }));

app.use((_, res) => res.status(404).json({ error: 'Not found' }));

async function start() {
  if (process.env.MONGODB_URI) {
    try {
      await connectDb();
      try {
        const { loadPaperPortfolioStateIntoStore } = await import('./services/paperPortfolioPersistence.js');
        const { paperTradingStore } = await import('./services/PaperTradingStore.js');
        const loaded = await loadPaperPortfolioStateIntoStore(paperTradingStore);
        if (loaded) {
          logger.info('Paper portfolio', { msg: 'Restored open positions and cash from MongoDB' });
        }
      } catch (err) {
        logger.warn('Paper portfolio restore skipped', { error: err?.message });
      }
    } catch (err) {
      logger.error('Startup failed: database connection', { error: err?.message });
      process.exit(1);
    }
  }
  server.listen(config.port, async () => {
    logger.info('Backend listening', { port: config.port, url: `http://localhost:${config.port}` });
    try {
      const { startPaperTradingScheduler } = await import('./services/PaperTradingSchedulerService.js');
      startPaperTradingScheduler();
    } catch (err) {
      logger.warn('Paper trading scheduler not started', { error: err?.message });
    }
  });
}

start();

// Graceful shutdown
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutdown signal received', { signal });
  try {
    const { shutdownBot } = await import('./routes/bot.js');
    if (typeof shutdownBot === 'function') {
      await shutdownBot();
      logger.info('Bot engine stopped');
    }
    const { stopScheduler } = await import('./services/SwingSchedulerService.js');
    if (typeof stopScheduler === 'function') {
      stopScheduler();
      logger.info('Swing scheduler stopped');
    }
    const { stopPaperTradingScheduler } = await import('./services/PaperTradingSchedulerService.js');
    if (typeof stopPaperTradingScheduler === 'function') {
      stopPaperTradingScheduler();
      logger.info('Paper trading scheduler stopped');
    }
    await disconnectDb().catch(() => {});
    io.close(() => logger.info('Socket.IO closed'));
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15000);
  } catch (err) {
    logger.error('Shutdown error', { error: err?.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
