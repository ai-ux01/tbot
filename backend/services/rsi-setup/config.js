/**
 * RSI Momentum Reset strategy configuration.
 * Only the parameters defined in the spec. No trend/volume/EMA filters.
 */

export const RSI_SETUP_CONFIG = {
  rsiLength: Number(process.env.RSI_LENGTH) || 14,
  rsiPeakThreshold: Number(process.env.RSI_PEAK_THRESHOLD) || 70,
  pullbackLowMin: Number(process.env.RSI_PULLBACK_LOW_MIN) || 35,
  pullbackLowMax: Number(process.env.RSI_PULLBACK_LOW_MAX) || 45,
  reboundMin: Number(process.env.RSI_REBOUND_MIN) || 55,
  reboundMax: Number(process.env.RSI_REBOUND_MAX) || 65,
  /** Price tolerance % for close ≈ low1_price. E.g. 0.5 = 0.5% */
  priceTolerancePct: Number(process.env.RSI_PRICE_TOLERANCE_PCT) || 0.5,
  /** HIGH confidence: price deviation ≤ this % */
  highConfidenceTolerancePct: Number(process.env.RSI_HIGH_CONF_TOLERANCE_PCT) || 0.25,
};

export default RSI_SETUP_CONFIG;
