/**
 * Scan stored daily candles for RSI↓MA Setup (copy) live daily BUY (same rule as GET /signals/rsi-ma-setup-copy/combined?liveOnly=1).
 * Used by the paper trading cron to auto-tick all qualifying symbols without listing them in PAPER_TRADING_AUTO.
 */

import { getCandlesForSignal, getSymbolsWithStoredCandles } from './SignalEngine.js';
import { evaluate as evaluateRsiMaSetupCopyLastBar } from './rsiMaSetupCopy.js';

const RSI_MA_MIN_DAILY_BARS = 30;
const DEFAULT_SYMBOL_LIMIT = 5000;

/**
 * @param {object} [opts]
 * @param {number} [opts.symbolLimit] - cap symbols scanned (default 5000)
 * @param {number} [opts.orderValueInr] - default 10000
 * @param {number} [opts.profitTargetPct] - optional paper rule (percent number, same as API)
 * @param {number} [opts.rsiRemainderExit] - optional
 * @param {number} [opts.maxHoldingDays] - optional
 * @returns {Promise<{ rows: object[], symbolsChecked: number, liveBuyCount: number }>}
 */
export async function fetchRsiMaCopyLiveDailyPaperRows(opts = {}) {
  const orderValueInr =
    opts.orderValueInr != null && Number.isFinite(Number(opts.orderValueInr))
      ? Number(opts.orderValueInr)
      : 10_000;
  const limitRaw = opts.symbolLimit != null ? Number(opts.symbolLimit) : DEFAULT_SYMBOL_LIMIT;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(10000, Math.floor(limitRaw))) : DEFAULT_SYMBOL_LIMIT;

  const rowExtra = {};
  if (opts.profitTargetPct != null && Number.isFinite(Number(opts.profitTargetPct))) {
    rowExtra.profitTargetPct = Number(opts.profitTargetPct);
  }
  if (opts.rsiRemainderExit != null && Number.isFinite(Number(opts.rsiRemainderExit))) {
    rowExtra.rsiRemainderExit = Number(opts.rsiRemainderExit);
  }
  if (opts.partialTpFraction != null && Number.isFinite(Number(opts.partialTpFraction))) {
    rowExtra.partialTpFraction = Number(opts.partialTpFraction);
  }
  if (opts.maxHoldingDays != null && Number.isFinite(Number(opts.maxHoldingDays))) {
    rowExtra.maxHoldingDays = Number(opts.maxHoldingDays);
  }

  const symbols = await getSymbolsWithStoredCandles();
  const n = Math.min(symbols.length, limit);
  const rows = [];

  for (let i = 0; i < n; i++) {
    const { symbol: sym, tradingsymbol: ts } = symbols[i];
    const tokenOrSym = sym || ts;
    if (!tokenOrSym) continue;
    try {
      const candles = await getCandlesForSignal(tokenOrSym, 'day', 500);
      if (candles.length < RSI_MA_MIN_DAILY_BARS) continue;
      const ohlcv = candles.map((c) => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      }));
      const result = evaluateRsiMaSetupCopyLastBar(ohlcv);
      if (result.signal !== 'BUY') continue;
      rows.push({
        setupId: 'rsi-ma-setup-copy',
        symbol: String(sym || ts).trim(),
        orderValueInr,
        series: 'day',
        ...rowExtra,
      });
    } catch {
      /* skip symbol */
    }
  }

  return { rows, symbolsChecked: n, liveBuyCount: rows.length };
}
