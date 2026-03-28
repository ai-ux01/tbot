/**
 * RSI Momentum Reset strategy configuration.
 * Only the parameters defined in the spec. No trend/volume/EMA filters.
 */

export const RSI_SETUP_CONFIG = {
  rsiLength: Number(process.env.RSI_LENGTH) || 14,
  rsiPeakThreshold: Number(process.env.RSI_PEAK_THRESHOLD) || 70,
  pullbackLowMin: Number(process.env.RSI_PULLBACK_LOW_MIN) || 30,
  pullbackLowMax: Number(process.env.RSI_PULLBACK_LOW_MAX) || 45,
  reboundMin: Number(process.env.RSI_REBOUND_MIN) || 40,
  reboundMax: Number(process.env.RSI_REBOUND_MAX) || 60,
  /** Second pullback RSI range (entry zone) */
  pullback2Min: Number(process.env.RSI_PULLBACK2_MIN) || 35,
  pullback2Max: Number(process.env.RSI_PULLBACK2_MAX) || 60,
  /** RSI points: |RSI − RSI MA| ≤ this counts as “near” the MA (looser touch). */
  maTouchTolerance: Number(process.env.RSI_MA_TOUCH_TOLERANCE) || 2.5,
  /** RSI points: RSI may sit slightly above MA and still qualify (≤ slack above MA). */
  maTouchAboveSlack: Number(process.env.RSI_MA_TOUCH_ABOVE_SLACK) || 3.5,
  /** Price tolerance % for close ≈ low1_price. E.g. 0.5 = 0.5% */
  priceTolerancePct: Number(process.env.RSI_PRICE_TOLERANCE_PCT) || 0.5,
  /** HIGH confidence: price deviation ≤ this % */
  highConfidenceTolerancePct: Number(process.env.RSI_HIGH_CONF_TOLERANCE_PCT) || 0.25,
  /**
   * Backtest: stop when low ≤ pullback_low * (1 − this). Pullback low = lowest before rebound (40–60).
   * E.g. 0.03 = 3% under that low.
   */
  stopLossFromPullbackLowPct: Number(process.env.RSI_STOP_LOSS_PULLBACK_LOW_PCT) || 0.03,
};

export default RSI_SETUP_CONFIG;
