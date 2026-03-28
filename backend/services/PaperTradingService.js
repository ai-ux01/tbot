/**
 * Evaluate stored-candle signals per setup (same universe as backtest hub) and apply paper trades.
 */

import { getCandlesForSignal } from './SignalEngine.js';
import { aggregateDailyToMonthly, normalizeBacktestSeries } from './candleAggregate.js';
import { evaluate as evaluateRsiSetup, normalizeRsiSetupMode } from './rsi-setup/index.js';
import { evaluate as evaluateEightyPercent } from './eightyPercentSetup.js';
import { evaluate as evaluateRsiMaSetupCopy } from './rsiMaSetupCopy.js';
import { evaluate as evaluateEmaCrossover } from './emaCrossover.js';
import { paperTradingStore } from './PaperTradingStore.js';
import { persistPaperClosedTrade } from './paperTradePersistence.js';

const RSI_MA_DAILY_FETCH_FOR_MONTHLY = 5000;
const RSI_MA_MIN_MONTHLY_BARS = 30;
const RSI_MA_MIN_DAILY_BARS = 30;

export const PAPER_TRADING_SETUPS = [
  { id: 'rsi-setup', label: 'RSI Setup (momentum reset)', timeframe: 'day', hasSeries: false },
  { id: 'eighty-percent', label: 'RSI↓MA Setup', timeframe: 'day', hasSeries: true },
  { id: 'rsi-ma-setup-copy', label: 'RSI↓MA Setup (copy)', timeframe: 'day', hasSeries: true },
  { id: 'ema-crossover', label: 'EMA 10/20 crossover', timeframe: '60minute', hasSeries: false },
];

async function loadRsiMaOhlcv(symbol, series) {
  const mode = normalizeBacktestSeries(series);
  if (mode === 'month') {
    const dailies = await getCandlesForSignal(symbol, 'day', RSI_MA_DAILY_FETCH_FOR_MONTHLY);
    const months = aggregateDailyToMonthly(dailies);
    if (months.length < RSI_MA_MIN_MONTHLY_BARS) {
      return {
        ok: false,
        error: `Insufficient monthly bars (${months.length}, need ≥${RSI_MA_MIN_MONTHLY_BARS}).`,
      };
    }
    const ohlcv = months.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0,
      time: c.time,
    }));
    return { ok: true, ohlcv, barUnit: 'month' };
  }
  const candles = await getCandlesForSignal(symbol, 'day', 500);
  if (candles.length < RSI_MA_MIN_DAILY_BARS) {
    return {
      ok: false,
      error: `Insufficient daily candles (${candles.length}, need ≥${RSI_MA_MIN_DAILY_BARS}).`,
    };
  }
  const ohlcv = candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
    time: c.time,
  }));
  return { ok: true, ohlcv, barUnit: 'day' };
}

/**
 * @param {string} setupId
 * @param {string} symbol
 * @param {object} [opts]
 * @param {string} [opts.timeframe] - rsi-setup only
 * @param {string} [opts.mode] - rsi-setup
 * @param {object} [opts.thresholds] - rsi-setup
 * @param {string} [opts.series] - eighty-percent / rsi-ma-setup-copy: day | month
 */
export async function evaluatePaperSetup(setupId, symbol, opts = {}) {
  const sym = String(symbol || '').trim();
  if (!sym) return { error: 'symbol required' };

  const meta = PAPER_TRADING_SETUPS.find((s) => s.id === setupId);
  if (!meta) return { error: `Unknown setupId. Use one of: ${PAPER_TRADING_SETUPS.map((s) => s.id).join(', ')}` };

  try {
    if (setupId === 'rsi-setup') {
      const timeframe = String(opts.timeframe || meta.timeframe || 'day').trim();
      const mode = normalizeRsiSetupMode(opts.mode);
      const thresholds = opts.thresholds && typeof opts.thresholds === 'object' ? opts.thresholds : {};
      const candles = await getCandlesForSignal(sym, timeframe, 500);
      if (candles.length < 50) {
        return { error: `Insufficient candles (${candles.length}, need ≥50)`, setupId, symbol: sym };
      }
      const ohlcv = candles.map((c) => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      }));
      const result = evaluateRsiSetup(ohlcv, {}, { mode, thresholds });
      const last = ohlcv[ohlcv.length - 1];
      const currentPrice =
        last?.close != null && Number.isFinite(Number(last.close)) ? Number(last.close) : null;
      const signal_type = result.signal === 'BUY' ? 'BUY' : 'HOLD';
      return {
        setupId,
        symbol: sym,
        timeframe,
        barUnit: timeframe,
        signal_type,
        entryPrice: result.entryPrice != null ? Number(result.entryPrice) : null,
        currentPrice,
        explanation: result.explanation || '',
        mode,
      };
    }

    if (setupId === 'eighty-percent' || setupId === 'rsi-ma-setup-copy') {
      const series = opts.series != null ? String(opts.series) : 'day';
      const loaded = await loadRsiMaOhlcv(sym, series);
      if (!loaded.ok) return { error: loaded.error, setupId, symbol: sym };
      const ev =
        setupId === 'eighty-percent'
          ? evaluateEightyPercent(loaded.ohlcv)
          : evaluateRsiMaSetupCopy(loaded.ohlcv);
      const last = loaded.ohlcv[loaded.ohlcv.length - 1];
      const currentPrice =
        last?.close != null && Number.isFinite(Number(last.close)) ? Number(last.close) : null;
      const signal_type = ev.signal === 'BUY' ? 'BUY' : 'HOLD';
      return {
        setupId,
        symbol: sym,
        series,
        barUnit: loaded.barUnit,
        signal_type,
        entryPrice: ev.entryPrice != null ? Number(ev.entryPrice) : null,
        currentPrice,
        explanation: ev.explanation || '',
      };
    }

    if (setupId === 'ema-crossover') {
      const candles = await getCandlesForSignal(sym, '60minute', 500);
      if (candles.length < 51) {
        return { error: `Insufficient 1H candles (${candles.length}, need ≥51)`, setupId, symbol: sym };
      }
      const closes = candles.map((c) => c.close);
      const r = evaluateEmaCrossover(closes);
      const currentPrice = closes[closes.length - 1];
      return {
        setupId,
        symbol: sym,
        timeframe: '60minute',
        barUnit: '60minute',
        signal_type: r.signal,
        entryPrice: r.entryPrice != null ? Number(r.entryPrice) : null,
        currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
        explanation: r.explanation || '',
      };
    }

    return { error: 'Unsupported setup', setupId };
  } catch (e) {
    return { error: e?.message ?? 'Evaluation failed', setupId, symbol: sym };
  }
}

function qtyFromOrderValue(orderValueInr, price) {
  const v = Number(orderValueInr);
  const px = Number(price);
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(px) || px <= 0) return 0;
  return Math.floor(v / px);
}

/**
 * @param {import('./PaperTradingStore.js').PaperTradingStore} store
 */
export async function applyPaperTick(store, setupId, symbol, orderValueInr, opts = {}) {
  const snap = await evaluatePaperSetup(setupId, symbol, opts);
  if (snap.error) {
    return { ok: false, error: snap.error, snapshot: snap };
  }

  const price =
    snap.currentPrice != null && Number.isFinite(snap.currentPrice)
      ? snap.currentPrice
      : snap.entryPrice != null && Number.isFinite(snap.entryPrice)
        ? snap.entryPrice
        : null;
  if (price == null || price <= 0) {
    return { ok: false, error: 'No usable price for paper execution.', snapshot: snap };
  }

  const open = store.getOpen(setupId, symTrim(symbol));

  if (snap.signal_type === 'SELL' && open) {
    const closed = store.closeLong(setupId, symTrim(symbol), price, 'signal_sell', snap);
    await persistAfterClose(store, closed.trade, snap);
    return {
      ok: closed.success,
      action: 'CLOSE',
      snapshot: snap,
      trade: closed.trade,
      error: closed.error,
      state: store.getState(),
    };
  }

  if (snap.signal_type === 'BUY' && !open) {
    const qty = qtyFromOrderValue(orderValueInr, price);
    if (qty < 1) {
      return {
        ok: false,
        action: 'SKIP',
        reason: 'Computed quantity < 1 (raise order value or pick a cheaper symbol).',
        snapshot: snap,
        state: store.getState(),
      };
    }
    const opened = store.openLong({
      setupId,
      symbol: symTrim(symbol),
      tradingsymbol: symTrim(symbol),
      qty,
      price,
      orderValueInr: Number(orderValueInr),
      snapshot: {
        ...snap,
        evaluatedAt: new Date().toISOString(),
      },
    });
    return {
      ok: opened.success,
      action: opened.success ? 'OPEN' : 'SKIP',
      snapshot: snap,
      position: opened.position,
      error: opened.error,
      state: store.getState(),
    };
  }

  return {
    ok: true,
    action: 'NONE',
    snapshot: snap,
    message:
      snap.signal_type === 'HOLD'
        ? 'Signal HOLD — no trade.'
        : snap.signal_type === 'BUY' && open
          ? 'Already long; ignored duplicate BUY.'
          : 'No action.',
    state: store.getState(),
  };
}

function symTrim(symbol) {
  return String(symbol || '').trim();
}

async function persistAfterClose(store, trade, exitSnapshot) {
  if (!trade) return;
  try {
    await persistPaperClosedTrade(trade, {
      exitSnapshot,
      initialCapital: store.initialCapital,
    });
  } catch {
    /* logged in persistence */
  }
}

/**
 * Close at latest bar close for the setup’s timeframe / series.
 */
export async function closePaperPositionAtMarket(store, setupId, symbol, opts = {}) {
  const sym = symTrim(symbol);
  const snap = await evaluatePaperSetup(setupId, sym, opts);
  if (snap.error) return { ok: false, error: snap.error };
  const price =
    snap.currentPrice != null && Number.isFinite(snap.currentPrice) ? snap.currentPrice : null;
  if (price == null || price <= 0) return { ok: false, error: 'No current price to close.' };
  const closed = store.closeLong(setupId, sym, price, 'manual_market', snap);
  await persistAfterClose(store, closed.trade, snap);
  return {
    ok: closed.success,
    trade: closed.trade,
    error: closed.error,
    state: store.getState(),
  };
}

export function getPaperTradingState() {
  return paperTradingStore.getState();
}

export function resetPaperTrading() {
  paperTradingStore.reset();
  return paperTradingStore.getState();
}
