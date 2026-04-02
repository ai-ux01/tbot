/**
 * Defaults for RSI↓MA Setup (copy) UI filters — keep aligned with backend
 * `backend/services/rsiMaSetupCopy.js`:
 * `RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PCT`, `RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT`.
 */
export const RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PCT = 0.1;

/** Backtest “Partial TP %” input: whole percent sent to API (10 → 10% gain vs avg). */
export const RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT =
  RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PCT * 100;

export const RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT = 70;

/** % of position sold at first take-profit (80 = default; 100 = full exit at that price, no remainder RSI leg). */
export const RSI_MA_COPY_DEFAULT_PARTIAL_EXIT_QTY_PERCENT = 80;
