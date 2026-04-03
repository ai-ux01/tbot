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

/** Matches backend `MIN_STOCK_PRICE` when min field is left blank (server default). */
export const RSI_MA_COPY_DEFAULT_MIN_STOCK_PRICE = 20;

/**
 * Build optional query/body fields for copy setup price band (cross-down close & entry low).
 * @param {string} minInput
 * @param {string} maxInput
 * @returns {{ minStockPrice?: number, maxStockPrice?: number }}
 */
export function rsiMaCopyPriceQueryFromInputs(minInput, maxInput) {
  const out = {};
  const minT = String(minInput ?? '').trim();
  const maxT = String(maxInput ?? '').trim();
  if (minT !== '') {
    const n = Number(minT);
    if (Number.isFinite(n) && n >= 0) out.minStockPrice = n;
  }
  if (maxT !== '') {
    const n = Number(maxT);
    if (Number.isFinite(n) && n > 0) out.maxStockPrice = n;
  }
  return out;
}
