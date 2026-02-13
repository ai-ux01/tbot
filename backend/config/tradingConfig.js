/**
 * Central trading configuration.
 * NEW IMPROVEMENTS: Production-grade config for swing + portfolio risk.
 * Does not affect intraday bot (intraday uses its own risk in BotEngine).
 */

const defaults = {
  // --- Risk (swing / portfolio) ---
  riskPerTrade: 0.01,
  maxOpenPositions: 5,
  maxPortfolioExposure: 0.5,
  maxSectorExposure: 0.2,

  // --- Liquidity (UniverseService) ---
  minPrice: 50,
  minAvgVolume: 1_000_000,
  liquidityLookbackDays: 20,

  // --- Market regime (NIFTY 50) ---
  enableMarketRegimeFilter: true,
  /** NIFTY 50 instrument token for regime check (e.g. nse_cm|99926000). Set via env TRADING_NIFTY50_TOKEN. */
  nifty50InstrumentToken: process.env.TRADING_NIFTY50_TOKEN || 'nse_cm|99926000',

  // --- Position sizing ---
  atrPeriod: 14,
  /** Capital for swing (used when not passed per-request). */
  defaultCapital: 100_000,

  // --- Feature flags (backward compatibility) ---
  /** Use PortfolioSwingEngine (with liquidity, regime, ATR sizing, journal) when true; else legacy SwingEngine. */
  usePortfolioSwingEngine: process.env.USE_PORTFOLIO_SWING_ENGINE === 'true',
};

/**
 * @returns {typeof defaults}
 */
export function getTradingConfig() {
  return {
    ...defaults,
    riskPerTrade: Number(process.env.TRADING_RISK_PER_TRADE) || defaults.riskPerTrade,
    maxOpenPositions: Number(process.env.TRADING_MAX_OPEN_POSITIONS) || defaults.maxOpenPositions,
    maxPortfolioExposure: Number(process.env.TRADING_MAX_PORTFOLIO_EXPOSURE) || defaults.maxPortfolioExposure,
    maxSectorExposure: Number(process.env.TRADING_MAX_SECTOR_EXPOSURE) || defaults.maxSectorExposure,
    minPrice: Number(process.env.TRADING_MIN_PRICE) || defaults.minPrice,
    minAvgVolume: Number(process.env.TRADING_MIN_AVG_VOLUME) || defaults.minAvgVolume,
    liquidityLookbackDays: Number(process.env.TRADING_LIQUIDITY_LOOKBACK_DAYS) || defaults.liquidityLookbackDays,
    enableMarketRegimeFilter: process.env.TRADING_ENABLE_MARKET_REGIME !== 'false',
    nifty50InstrumentToken: process.env.TRADING_NIFTY50_TOKEN || defaults.nifty50InstrumentToken,
    atrPeriod: Number(process.env.TRADING_ATR_PERIOD) || defaults.atrPeriod,
    defaultCapital: Number(process.env.TRADING_DEFAULT_CAPITAL) || defaults.defaultCapital,
    usePortfolioSwingEngine: process.env.USE_PORTFOLIO_SWING_ENGINE === 'true',
  };
}

export default getTradingConfig;
