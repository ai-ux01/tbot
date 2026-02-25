/**
 * ConfidenceScorer: 0-100 score with LOW | MEDIUM | HIGH label.
 * Components: RSI structure, trend strength, volume, market strength, ATR quality, higher-low strength.
 */

import { RSI_SETUP_CONFIG } from './config.js';

/** @typedef {'LOW'|'MEDIUM'|'HIGH'} ConfidenceLabel */

/**
 * Score RSI structure quality (0-1): symmetry of peak1→low1→peak2→low2, pullback depth.
 * @param {{ peak1: number, low1: number, peak2: number, low2: number }}
 */
function scoreRsiStructure(structure) {
  if (!structure || structure.peak1 == null || structure.low1 == null || structure.peak2 == null || structure.low2 == null) {
    return 0;
  }
  const { peak1, low1, peak2, low2 } = structure;
  let score = 0.5; // base
  const pullback1 = peak1 - low1;
  const pullback2 = peak2 - low2;
  const symmetry = Math.abs(pullback1 - pullback2) / Math.max(pullback1, pullback2, 1);
  score += (1 - Math.min(symmetry, 1)) * 0.25; // symmetry bonus
  const low2NearLow1 = Math.abs(low2 - low1) <= (RSI_SETUP_CONFIG.low2Tolerance || 5);
  if (low2NearLow1) score += 0.25;
  return Math.min(1, score);
}

/**
 * Score trend strength (0-1): EMA20 distance from EMA50, close above EMA50.
 */
function scoreTrendStrength(close, ema20, ema50) {
  if (close == null || ema20 == null || ema50 == null || ema50 <= 0) return 0;
  const emaDistance = (ema20 - ema50) / ema50;
  let score = 0.5;
  if (emaDistance > 0.01) score += 0.25;
  if (emaDistance > 0.02) score += 0.25;
  if (close > ema50) score += 0.25;
  return Math.min(1, score);
}

/**
 * Score volume expansion (0-1): current volume vs avgVolume.
 */
function scoreVolumeExpansion(volume, avgVolume) {
  if (volume == null || avgVolume == null || avgVolume <= 0) return 0;
  const ratio = volume / avgVolume;
  if (ratio < 1) return Math.min(0.5, ratio);
  if (ratio >= 2) return 1;
  return 0.5 + (ratio - 1) * 0.5;
}

/**
 * Score market strength (0-1): NIFTY distance above EMA200.
 * niftyTrendStrength = (niftyClose - niftyEma200) / niftyEma200. Pass pre-computed.
 */
function scoreMarketStrength(niftyTrendStrength) {
  if (niftyTrendStrength == null || !Number.isFinite(niftyTrendStrength)) return 0.5; // neutral when unknown
  if (niftyTrendStrength <= 0) return 0;
  if (niftyTrendStrength >= 0.02) return 1;
  return niftyTrendStrength / 0.02;
}

/**
 * Score ATR volatility quality (0-1): ATR not too small (no movement) or too large (chaos).
 * Ideal: ATR/price between ~1% and ~4%.
 */
function scoreAtrQuality(atr, price) {
  if (atr == null || price == null || price <= 0) return 0.5;
  const atrPct = (atr / price) * 100;
  if (atrPct < 0.5) return 0.2; // too quiet
  if (atrPct > 8) return 0.3; // too volatile
  if (atrPct >= 1 && atrPct <= 4) return 1; // ideal
  if (atrPct >= 0.5 && atrPct < 1) return 0.5 + (atrPct - 0.5) * 1; // 0.5-1
  return 0.8; // 4-8% acceptable
}

/**
 * Score price higher-low strength (0-1): low2 >= low1 (or close) = good structure.
 */
function scoreHigherLowStrength(priceLow1, priceLow2) {
  if (priceLow1 == null || priceLow2 == null) return 0.5;
  const diff = priceLow2 - priceLow1;
  if (diff >= 0) return 1; // strict higher low
  const pctDiff = Math.abs(diff) / Math.max(priceLow1, 0.01);
  if (pctDiff <= 0.01) return 0.9; // within 1%
  if (pctDiff <= 0.02) return 0.7;
  return 0.5;
}

/**
 * Map raw score 0-100 to label.
 * @param {number} score
 * @returns {ConfidenceLabel}
 */
export function getConfidenceLabel(score) {
  if (score >= 71) return 'HIGH';
  if (score >= 41) return 'MEDIUM';
  return 'LOW';
}

/**
 * Compute full confidence score and label.
 * @param {{
 *   structure: { peak1, low1, peak2, low2 },
 *   close: number, ema20: number, ema50: number,
 *   volume: number, avgVolume: number,
 *   atr: number, price: number,
 *   niftyTrendStrength?: number,
 *   priceLow1?: number, priceLow2?: number
 * }} ctx
 * @returns {{ confidenceScore: number, confidenceLabel: ConfidenceLabel }}
 */
export function computeConfidence(ctx) {
  const weights = RSI_SETUP_CONFIG.confidenceWeights;
  let score = 0;

  score += scoreRsiStructure(ctx.structure) * (weights.rsiStructure || 25);
  score += scoreTrendStrength(ctx.close, ctx.ema20, ctx.ema50) * (weights.trendStrength || 20);
  score += scoreVolumeExpansion(ctx.volume, ctx.avgVolume) * (weights.volumeExpansion || 20);
  score += scoreMarketStrength(ctx.niftyTrendStrength) * (weights.marketStrength || 15);
  score += scoreAtrQuality(ctx.atr, ctx.price) * (weights.atrQuality || 10);
  score += scoreHigherLowStrength(ctx.priceLow1, ctx.priceLow2) * (weights.higherLowStrength || 10);

  const confidenceScore = Math.round(Math.min(100, Math.max(0, score)));
  const confidenceLabel = getConfidenceLabel(confidenceScore);

  return { confidenceScore, confidenceLabel };
}

export default { computeConfidence, getConfidenceLabel };
