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
