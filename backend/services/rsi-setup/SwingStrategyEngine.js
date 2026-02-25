/**
 * RSI Momentum Reset in Uptrend (1D Only)
 * Uses RSIMomentumResetStrategy for strict state-machine evaluation.
 */

import { RSI_SETUP_CONFIG } from './config.js';
import { RSIMomentumResetStrategy } from './RSIMomentumResetStrategy.js';

/**
 * Evaluate RSI Momentum Reset. Returns signal for the last (current) bar.
 * @param {Array<{ open, high, low, close, volume? }>} ohlcv - Candles oldest first
 * @returns {{ signal: 'BUY'|'HOLD', entryPrice?, confidenceLabel?, confidenceScore?, structure?, explanation? }}
 */
export function evaluate(ohlcv, _marketContext = {}) {
  const emptyResult = {
    signal: 'HOLD',
    explanation: 'Insufficient data or structure not found.',
  };

  if (!Array.isArray(ohlcv) || ohlcv.length < 50) return emptyResult;

  const closes = ohlcv
    .map((c) => (c && typeof c.close === 'number' && Number.isFinite(c.close) ? c.close : null))
    .filter((v) => v != null);

  if (closes.length < 50) return emptyResult;

  const strategy = new RSIMomentumResetStrategy({
    rsiLength: RSI_SETUP_CONFIG.rsiLength ?? 14,
    rsiMaLength: RSI_SETUP_CONFIG.rsiLength ?? 14,
    tolerancePercent: RSI_SETUP_CONFIG.priceTolerancePct ?? 0.5,
    pullback2Min: RSI_SETUP_CONFIG.pullback2Min ?? 35,
    pullback2Max: RSI_SETUP_CONFIG.pullback2Max ?? 60,
  });

  const results = strategy.evaluate(closes);
  const last = results[results.length - 1];

  if (!last || !last.signal) return emptyResult;

  const confidenceScore =
    last.confidence === 'HIGH' ? 85 : last.confidence === 'MEDIUM' ? 65 : 45;

  const explanation = [
    'BUY: RSI momentum reset.',
    `Peak ≥70 → Low1 (35–45) → Rebound (55–65) → Second pullback at ${last.entryPrice?.toFixed(2)}.`,
    `RSI touched/crossed RSI SMA, turning up. Confidence: ${last.confidence}.`,
  ].join(' ');

  return {
    signal: 'BUY',
    entryPrice: last.entryPrice,
    confidenceLabel: last.confidence,
    confidenceScore,
    structure: {
      low1Index: last.low1Index,
      entryIndex: last.entryIndex,
    },
    explanation,
    reason: 'RSI momentum reset',
  };
}

export default { evaluate };
