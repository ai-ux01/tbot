/**
 * Signals API: list signals, get indicators, trigger evaluation.
 */

import { Router } from 'express';
import { Signal } from '../database/models/Signal.js';
import { isDbConnected } from '../database/connection.js';
import { computeIndicators } from '../services/IndicatorService.js';
import { evaluateAndPersistSignal, getCandlesForSignal, getSymbolsWithStoredCandles } from '../services/SignalEngine.js';
import { trainModel } from '../services/PatternService.js';
import { getAlertService } from '../services/AlertService.js';
import { logger } from '../logger.js';

const router = Router();

// Initialize alert service on first use
getAlertService();

/**
 * GET /api/signals
 * List latest signals. Query: instrument, timeframe, limit (default 50).
 */
router.get('/', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const instrument = (req.query.instrument || '').trim();
    const timeframe = (req.query.timeframe || '').trim();
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const filter = {};
    if (instrument) filter.instrument = instrument;
    if (timeframe) filter.timeframe = timeframe;
    const list = await Signal.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ signals: list });
  } catch (err) {
    logger.error('Signals list failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'List failed' });
  }
});

/**
 * GET /api/signals/combined
 * One row per instrument: latest 1D and 1H signals combined.
 * Combined = BUY only if both 1D and 1H are BUY; SELL only if both are SELL; else HOLD.
 */
router.get('/combined', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const limit = Math.min(500, Math.max(50, parseInt(req.query.limit, 10) || 200));
    const instrumentFilter = (req.query.instrument || '').trim();
    const raw = await Signal.find({
      timeframe: { $in: ['day', '60minute'] },
      ...(instrumentFilter ? { $or: [{ instrument: instrumentFilter }, { tradingsymbol: new RegExp(`^${instrumentFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }] } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(limit * 2)
      .lean();

    const byInstrument = {};
    for (const s of raw) {
      const key = String(s.instrument || s.tradingsymbol || '').trim();
      if (!key) continue;
      if (!byInstrument[key]) {
        byInstrument[key] = { instrument: s.instrument, tradingsymbol: s.tradingsymbol || s.instrument, day: null, hour: null };
      }
      const slot = s.timeframe === 'day' ? 'day' : s.timeframe === '60minute' ? 'hour' : null;
      if (slot && byInstrument[key][slot] === null) {
        byInstrument[key][slot] = {
          signal_type: s.signal_type,
          confidence: s.confidence,
          createdAt: s.createdAt,
          explanation: s.explanation ?? '',
        };
      }
    }

    const combined = [];
    for (const [key, row] of Object.entries(byInstrument)) {
      const daySig = row.day?.signal_type;
      const hourSig = row.hour?.signal_type;
      let signal_type = 'HOLD';
      if (daySig === 'BUY' && hourSig === 'BUY') signal_type = 'BUY';
      else if (daySig === 'SELL' && hourSig === 'SELL') signal_type = 'SELL';

      const dayConf = row.day?.confidence;
      const hourConf = row.hour?.confidence;
      const dayExplanation = (row.day?.explanation && String(row.day.explanation).trim()) ? String(row.day.explanation).trim() : 'No explanation available.';
      const hourExplanation = (row.hour?.explanation && String(row.hour.explanation).trim()) ? String(row.hour.explanation).trim() : 'No explanation available.';
      const latestAt = [row.day?.createdAt, row.hour?.createdAt].filter(Boolean).sort().pop();

      combined.push({
        instrument: row.instrument || key,
        tradingsymbol: row.tradingsymbol || key,
        signal_type,
        daySignal: daySig || null,
        hourSignal: hourSig || null,
        dayConfidence: dayConf ?? null,
        hourConfidence: hourConf ?? null,
        dayExplanation,
        hourExplanation,
        createdAt: latestAt,
      });
    }
    combined.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json({ signals: combined });
  } catch (err) {
    logger.error('Signals combined failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Combined failed' });
  }
});

/**
 * GET /api/signals/indicators
 * Get indicators for symbol + timeframe (from stored candles). Query: symbol, timeframe, limit (default 500).
 */
router.get('/indicators', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const symbol = (req.query.symbol || req.query.instrument || '').trim();
    const timeframe = (req.query.timeframe || 'day').trim();
    const limit = Math.min(500, Math.max(50, parseInt(req.query.limit, 10) || 500));
    if (!symbol) {
      return res.status(400).json({ error: 'symbol or instrument required' });
    }
    const candles = await getCandlesForSignal(symbol, timeframe, limit);
    if (candles.length < 20) {
      return res.json({ indicators: null, message: 'Insufficient candles', count: candles.length });
    }
    const ohlcv = candles.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    const indicators = computeIndicators(ohlcv);
    res.json({ indicators, count: candles.length });
  } catch (err) {
    logger.error('Indicators failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Indicators failed' });
  }
});

/**
 * POST /api/signals/evaluate
 * Body: { instrument, tradingsymbol?, timeframe }
 * Runs full pipeline (indicators + ML + score + persist + alert) and returns the saved signal.
 */
router.post('/evaluate', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const { instrument, tradingsymbol, timeframe } = req.body || {};
    const sym = (instrument || tradingsymbol || '').trim();
    const tf = (timeframe || 'day').trim();
    if (!sym || !tf) {
      return res.status(400).json({ error: 'instrument and timeframe required' });
    }
    const signal = await evaluateAndPersistSignal({
      instrument: sym,
      tradingsymbol: (tradingsymbol || sym).trim(),
      timeframe: tf,
    });
    if (!signal) {
      return res.status(422).json({ error: 'Insufficient candle data for evaluation' });
    }
    res.json(signal);
  } catch (err) {
    logger.error('Evaluate signal failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Evaluate failed' });
  }
});

const EVALUATE_ALL_TIMEFRAMES = ['day', '60minute'];

/**
 * POST /api/signals/evaluate-all
 * Run evaluation for all symbols with stored candles, for 1D and 1H timeframes.
 * Returns { evaluated, errors, symbolCount }.
 */
router.post('/evaluate-all', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const symbols = await getSymbolsWithStoredCandles();
    let evaluated = 0;
    const errors = [];
    for (const { symbol, tradingsymbol } of symbols) {
      const inst = symbol || tradingsymbol;
      const trad = tradingsymbol || symbol;
      if (!inst) continue;
      for (const timeframe of EVALUATE_ALL_TIMEFRAMES) {
        try {
          const signal = await evaluateAndPersistSignal({
            instrument: String(inst),
            tradingsymbol: String(trad),
            timeframe,
          });
          if (signal) evaluated += 1;
        } catch (err) {
          errors.push({ symbol: inst, timeframe, error: err?.message ?? 'Evaluate failed' });
        }
      }
    }
    res.json({ evaluated, errors, symbolCount: symbols.length });
  } catch (err) {
    logger.error('Evaluate-all failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Evaluate-all failed' });
  }
});

/**
 * POST /api/signals/train
 * Trigger ML model training (proxies to ML service POST /train).
 * Returns { status, message?, stdout? }. 503 if ML_SERVICE_URL not set.
 */
router.post('/train', async (req, res) => {
  try {
    const data = await trainModel();
    res.json(data);
  } catch (err) {
    if (err?.code === 'ML_DISABLED') {
      return res.status(503).json({ error: 'ML service not configured (set ML_SERVICE_URL)' });
    }
    const status = err?.response?.status >= 400 ? err.response.status : 502;
    let message = err?.response?.data?.detail ?? err?.message ?? 'Training request failed';
    if (status === 502 && !err?.response) {
      message = 'ML service unreachable. Start it with: npm run ml (from project root).';
    }
    logger.error('Train failed', { error: err?.message, status: err?.response?.status, code: err?.code });
    res.status(status).json({ error: message });
  }
});

export default router;
