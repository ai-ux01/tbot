/**
 * Defaults for RSI↓MA Setup (copy) UI filters — keep aligned with backend
 * `backend/services/rsiMaSetupCopy.js`:
 * `RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PCT`, `RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT`.
 */
export const RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PCT = 0.7;

/** Backtest “Partial TP %” input: same as backend fraction, as a whole percent (70 → 0.7). */
export const RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT =
  RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PCT * 100;

export const RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT = 70;
