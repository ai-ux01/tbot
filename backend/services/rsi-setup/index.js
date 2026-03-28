/**
 * RSI Setup strategy module.
 * Institutional-level RSI Momentum Reset with ATR stop, 2R filter, confidence scoring.
 */

import { computeIndicators } from '../IndicatorService.js';

export { RSI_SETUP_CONFIG } from './config.js';
export {
  evaluate,
  evaluateAllSetups,
  formatRsiMomentumResetExplanation,
  normalizeRsiSetupMode,
  RSI_SETUP_MODES,
} from './SwingStrategyEngine.js';
export { RSIMomentumResetStrategy } from './RSIMomentumResetStrategy.js';

/**
 * Get NIFTY market context for regime filter. NIFTY 50 > EMA200.
 * @param {Array<{ open, high, low, close, volume? }>} niftyOhlcv - NIFTY daily candles
 * @returns {{ niftyTrendStrength: number | null }} (close - ema200) / ema200 when above EMA200
 */
export function getNiftyMarketContext(niftyOhlcv) {
  if (!Array.isArray(niftyOhlcv) || niftyOhlcv.length < 200) {
    return { niftyTrendStrength: null };
  }
  const indicators = computeIndicators(niftyOhlcv);
  const close = niftyOhlcv[niftyOhlcv.length - 1]?.close;
  const ema200 = indicators.ema200;
  if (close == null || ema200 == null || ema200 <= 0) {
    return { niftyTrendStrength: null };
  }
  const niftyTrendStrength = (close - ema200) / ema200;
  return { niftyTrendStrength };
}

export { runRsiSetupBacktest } from './backtest.js';
export { checkFailure } from './FailureDetector.js';
export {
  calculateStopLoss,
  calculateTarget,
  checkRiskRewardFilter,
  getRecentSwingHigh,
} from './RiskService.js';
export { computeConfidence, getConfidenceLabel } from './ConfidenceScorer.js';
