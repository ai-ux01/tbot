/**
 * Signal Engine: combines ML pattern probability + rule-based indicator signal + trend.
 * Persists to MongoDB "signals" collection and emits for AlertEngine.
 */

import { Candle } from '../database/models/Candle.js';
import { Signal } from '../database/models/Signal.js';
import { computeIndicators } from './IndicatorService.js';
import { predictPattern } from './PatternService.js';
import { buildExplanation } from './ExplanationService.js';
import { logger } from '../logger.js';
import { getAlertService } from './AlertService.js';

const CANDLE_LIMIT = 500;
/** Extra calendar history before `from` so RSI/MA have warmup when using a date range. */
const RANGE_WARMUP_MS = 200 * 24 * 60 * 60 * 1000;
const RANGE_MAX_DOCS = 10000;
const RANGE_FALLBACK_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const ML_WEIGHT = 0.6;
const INDICATOR_WEIGHT = 0.4;
const MIN_ML_PROB = 0.7;
const MIN_CONFIDENCE_ALERT = 0.75;

/**
 * Get distinct symbols that have stored candles (for evaluate-all).
 * @returns {Promise<Array<{ symbol: string, tradingsymbol: string }>>}
 */
export async function getSymbolsWithStoredCandles() {
  const rows = await Candle.aggregate([
    { $group: { _id: '$symbol', tradingsymbol: { $first: '$tradingsymbol' } } },
    { $sort: { _id: 1 } },
    { $project: { symbol: '$_id', tradingsymbol: 1, _id: 0 } },
  ]);
  return Array.isArray(rows) ? rows : [];
}

export function utcDayStartFromInput(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    if (Number.isNaN(t)) return null;
    return new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(), 0, 0, 0, 0));
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  }
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 0, 0, 0, 0));
}

export function utcDayEndFromInput(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    if (Number.isNaN(t)) return null;
    return new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(), 23, 59, 59, 999));
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  }
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 23, 59, 59, 999));
}

/**
 * Fetch last N candles from DB for symbol or tradingsymbol + timeframe (oldest first).
 * Uses most recent N candles so RSI/indicators reflect current bar, not oldest N.
 *
 * Optional `options.from` / `options.to` (Date or YYYY-MM-DD): load bars in window [from−warmup, to],
 * oldest first (cap RANGE_MAX_DOCS). Omits range behavior when both are null/undefined.
 */
export async function getCandlesForSignal(symbol, timeframe, limit = CANDLE_LIMIT, options = {}) {
  const sym = String(symbol).trim();
  const isToken = /^\d+$/.test(sym);
  const filter = { timeframe };
  if (isToken) filter.symbol = sym;
  else filter.$or = [{ symbol: sym }, { tradingsymbol: { $regex: new RegExp(`^${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }];

  const fromRaw = options?.from;
  const toRaw = options?.to;
  const useRange = fromRaw != null && fromRaw !== '' || (toRaw != null && toRaw !== '');

  if (useRange) {
    const fromDay = utcDayStartFromInput(fromRaw);
    const toDay = utcDayEndFromInput(toRaw);
    if ((fromRaw != null && fromRaw !== '' && !fromDay) || (toRaw != null && toRaw !== '' && !toDay)) {
      return [];
    }
    const nowEnd = utcDayEndFromInput(new Date());
    const upper = toDay ?? nowEnd;
    let lower;
    if (fromDay) {
      lower = new Date(fromDay.getTime() - RANGE_WARMUP_MS);
    } else if (toDay) {
      lower = new Date(toDay.getTime() - RANGE_FALLBACK_MS);
    } else {
      lower = new Date(0);
    }
    if (fromDay && upper.getTime() < fromDay.getTime()) {
      return [];
    }
    const docs = await Candle.find({
      ...filter,
      time: { $gte: lower, $lte: upper },
    })
      .sort({ time: 1 })
      .limit(RANGE_MAX_DOCS)
      .lean();
    return docs.map((d) => ({
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume ?? 0,
      time: d.time,
    }));
  }

  const docs = await Candle.find(filter)
    .sort({ time: -1 })
    .limit(limit)
    .lean();
  const ordered = docs.reverse();
  return ordered.map((d) => ({
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume ?? 0,
    time: d.time,
  }));
}

/**
 * Compute signal_type from ML + rule + trend.
 */
function resolveSignalType(mlResult, ruleSignal, trendPrediction) {
  const bullish = trendPrediction === 'BULLISH';
  const bearish = trendPrediction === 'BEARISH';
  const prob = mlResult?.probability ?? 0;

  if (prob >= MIN_ML_PROB && ruleSignal === 'BUY' && bullish) return 'BUY';
  if (prob >= MIN_ML_PROB && ruleSignal === 'SELL' && bearish) return 'SELL';
  return 'HOLD';
}

/**
 * Run full pipeline: fetch candles → indicators → ML predict → score → explain → persist → alert.
 * @param {{ instrument: string, tradingsymbol?: string, timeframe: string }}
 * @returns {Promise<object>} saved signal document (plain object)
 */
export async function evaluateAndPersistSignal({ instrument, tradingsymbol, timeframe }) {
  const candles = await getCandlesForSignal(instrument, timeframe, CANDLE_LIMIT);
  if (candles.length < 50) {
    logger.warn('SignalEngine: insufficient candles', { instrument, timeframe, count: candles.length });
    return null;
  }

  const ohlcv = candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

  const indicators = computeIndicators(ohlcv);
  const mlResult = await predictPattern(ohlcv).catch(() => null);
  const trendPrediction = mlResult?.trend_prediction || 'NEUTRAL';
  const ruleSignal = indicators.ruleSignal || 'HOLD';

  const confidence =
    (Number(mlResult?.probability ?? 0) * ML_WEIGHT) + (Number(indicators.indicatorStrength ?? 0.5) * INDICATOR_WEIGHT);
  const signal_type = resolveSignalType(mlResult, ruleSignal, trendPrediction);

  const lastCandles = candles.slice(-10);
  const explanation = await buildExplanation({
    pattern: mlResult ? { pattern: mlResult.pattern, probability: mlResult.probability, trend_prediction: trendPrediction } : {},
    indicators,
    lastCandles,
    instrument: tradingsymbol || instrument,
  });

  const lastCandle = candles[candles.length - 1];
  const signalDoc = {
    instrument,
    tradingsymbol: tradingsymbol || instrument,
    timeframe,
    signal_type,
    confidence: Math.min(1, Math.max(0, confidence)),
    explanation,
    pattern: {
      name: mlResult?.pattern || '',
      probability: mlResult?.probability ?? 0,
    },
    trend_prediction: trendPrediction,
    indicators: {
      ema20: indicators.ema20,
      ema50: indicators.ema50,
      ema200: indicators.ema200,
      rsi: indicators.rsi,
      ruleSignal: indicators.ruleSignal,
      indicatorStrength: indicators.indicatorStrength,
    },
    candleTime: lastCandle?.time,
  };

  const saved = await Signal.create(signalDoc);
  const plain = saved.toObject ? saved.toObject() : saved;

  if (signal_type !== 'HOLD' && plain.confidence >= MIN_CONFIDENCE_ALERT) {
    try {
      getAlertService().emit('signal', plain);
    } catch (e) {
      logger.warn('SignalEngine: alert emit failed', { error: e?.message });
    }
  }

  logger.info('SignalEngine: signal persisted', {
    instrument: plain.instrument,
    timeframe: plain.timeframe,
    signal_type: plain.signal_type,
    confidence: plain.confidence,
  });
  return plain;
}

export default { evaluateAndPersistSignal, getCandlesForSignal, getSymbolsWithStoredCandles };
