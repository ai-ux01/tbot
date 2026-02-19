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
const ML_WEIGHT = 0.6;
const INDICATOR_WEIGHT = 0.4;
const MIN_ML_PROB = 0.7;
const MIN_CONFIDENCE_ALERT = 0.75;

/**
 * Fetch last N candles from DB for symbol or tradingsymbol + timeframe (oldest first).
 */
export async function getCandlesForSignal(symbol, timeframe, limit = CANDLE_LIMIT) {
  const sym = String(symbol).trim();
  const isToken = /^\d+$/.test(sym);
  const filter = { timeframe };
  if (isToken) filter.symbol = sym;
  else filter.$or = [{ symbol: sym }, { tradingsymbol: { $regex: new RegExp(`^${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }];
  const docs = await Candle.find(filter)
    .sort({ time: 1 })
    .limit(limit)
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

export default { evaluateAndPersistSignal, getCandlesForSignal };
