/**
 * Evaluate stored-candle signals per setup (same universe as backtest hub) and apply paper trades.
 */

import { getCandlesForSignal } from './SignalEngine.js';
import { aggregateDailyToMonthly, normalizeBacktestSeries } from './candleAggregate.js';
import { evaluate as evaluateRsiSetup, normalizeRsiSetupMode } from './rsi-setup/index.js';
import {
  evaluate as evaluateEightyPercent,
  resolveEightyPercentPaperBarAction,
} from './eightyPercentSetup.js';
import {
  evaluate as evaluateRsiMaSetupCopy,
  resolveRsiMaCopyPaperIntrabarActions,
} from './rsiMaSetupCopy.js';
import { evaluate as evaluateEmaCrossover } from './emaCrossover.js';
import { computeIndicatorSeries } from './IndicatorService.js';
import { paperTradingStore } from './PaperTradingStore.js';
import { persistPaperClosedTrade } from './paperTradePersistence.js';
import { savePaperPortfolioState } from './paperPortfolioPersistence.js';
import { logger } from '../logger.js';

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
        lastCandleTime: last?.time ?? null,
      };
    }

    if (setupId === 'eighty-percent' || setupId === 'rsi-ma-setup-copy') {
      const series = opts.series != null ? String(opts.series) : 'day';
      const loaded = await loadRsiMaOhlcv(sym, series);
      if (!loaded.ok) return { error: loaded.error, setupId, symbol: sym };
      const ev =
        setupId === 'eighty-percent'
          ? evaluateEightyPercent(loaded.ohlcv)
          : evaluateRsiMaSetupCopy(loaded.ohlcv, {
              minStockPrice: opts.minStockPrice,
              maxStockPrice: opts.maxStockPrice,
            });
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
        lastCandleTime: last?.time ?? null,
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
      const lastC = candles[candles.length - 1];
      return {
        setupId,
        symbol: sym,
        timeframe: '60minute',
        barUnit: '60minute',
        signal_type: r.signal,
        entryPrice: r.entryPrice != null ? Number(r.entryPrice) : null,
        currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
        explanation: r.explanation || '',
        lastCandleTime: lastC?.time ?? null,
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
 * BUY open: rsi-ma-setup-copy uses lowest low while RSI is below 40; eighty-percent uses first dip-below-40 close — same as backtest + signals UI.
 * SELL / exit paths use latest bar close when available.
 * @param {string} setupId
 * @param {{ currentPrice?: number|null, entryPrice?: number|null }} snap
 */
export function resolvePaperExecutionPrices(setupId, snap) {
  const cur =
    snap?.currentPrice != null && Number.isFinite(snap.currentPrice) ? snap.currentPrice : null;
  const ent =
    snap?.entryPrice != null && Number.isFinite(snap.entryPrice) ? snap.entryPrice : null;
  const priceForExit =
    cur != null && cur > 0 ? cur : ent != null && ent > 0 ? ent : null;
  const useStrategyEntryOpen =
    setupId === 'rsi-ma-setup-copy' || setupId === 'eighty-percent';
  const priceForBuyOpen =
    useStrategyEntryOpen && ent != null && ent > 0
      ? ent
      : cur != null && cur > 0
        ? cur
        : ent != null && ent > 0
          ? ent
          : null;
  return { priceForBuyOpen, priceForExit };
}

function normalizeTimeMs(t) {
  if (t == null) return null;
  if (typeof t === 'number') {
    return t < 1e12 ? Math.floor(t * 1000) : Math.floor(t);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function calendarDayUtc(t) {
  if (t == null) return null;
  const ms = typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : t;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function barsHeldCount(ohlcv, entryCandleTime, fallbackOpenedAtIso) {
  if (!Array.isArray(ohlcv) || ohlcv.length === 0) return 0;
  const lastIdx = ohlcv.length - 1;
  const t0 = normalizeTimeMs(entryCandleTime);
  let ei = -1;
  if (t0 != null) {
    for (let i = 0; i < ohlcv.length; i++) {
      if (normalizeTimeMs(ohlcv[i]?.time) === t0) {
        ei = i;
        break;
      }
    }
    if (ei < 0) {
      for (let i = lastIdx; i >= 0; i--) {
        const ti = normalizeTimeMs(ohlcv[i]?.time);
        if (ti != null && ti <= t0) {
          ei = i;
          break;
        }
      }
    }
  }
  if (ei < 0 && fallbackOpenedAtIso) {
    const day = calendarDayUtc(fallbackOpenedAtIso);
    if (day) {
      for (let i = lastIdx; i >= 0; i--) {
        const ct = ohlcv[i]?.time;
        if (ct == null) continue;
        const cday = calendarDayUtc(ct);
        if (cday === day) {
          ei = i;
          break;
        }
      }
    }
  }
  if (ei < 0) ei = lastIdx;
  return Math.max(0, lastIdx - ei);
}

function normMaxHoldingDays(d, fallback) {
  if (d != null && Number.isFinite(Number(d)) && Number(d) >= 1) return Math.floor(Number(d));
  return fallback;
}

function defaultPaperRulesTemplate(setupId, opts) {
  if (setupId === 'rsi-ma-setup-copy') {
    return {
      kind: 'rsi-ma-setup-copy',
      entryCandleTime: null,
      series: opts.series != null ? String(opts.series) : 'day',
      profitTargetPct: opts.profitTargetPct,
      rsiRemainderExit: opts.rsiRemainderExit,
      partialTpFraction: opts.partialTpFraction,
      maxHoldingDays: normMaxHoldingDays(opts.maxHoldingDays, 7),
      partialTpDone: false,
    };
  }
  if (setupId === 'eighty-percent') {
    return {
      kind: 'eighty-percent',
      entryCandleTime: null,
      series: opts.series != null ? String(opts.series) : 'day',
      maxHoldingDays: normMaxHoldingDays(opts.maxHoldingDays, 7),
    };
  }
  if (setupId === 'rsi-setup') {
    return {
      kind: 'simple',
      entryCandleTime: null,
      timeframe: String(opts.timeframe || 'day').trim(),
      stopPct: 0.05,
      targetPct: 0.1,
      maxHoldingDays: normMaxHoldingDays(opts.maxHoldingDays, 7),
    };
  }
  if (setupId === 'ema-crossover') {
    return {
      kind: 'simple',
      entryCandleTime: null,
      timeframe: '60minute',
      stopPct: 0.05,
      targetPct: 0.1,
      maxHoldingBars: 42,
    };
  }
  return null;
}

function mergePaperRulesForExit(position, setupId, opts) {
  const template = defaultPaperRulesTemplate(setupId, opts);
  if (!template) return null;
  const base = position.paperRules && typeof position.paperRules === 'object' ? position.paperRules : {};
  return { ...template, ...base };
}

function buildPaperRulesForOpen(setupId, snap, opts) {
  const template = defaultPaperRulesTemplate(setupId, opts);
  if (!template) return null;
  return {
    ...template,
    entryCandleTime: snap?.lastCandleTime ?? null,
    partialTpDone: false,
  };
}

function resolveSimplePaperBar(avgEntry, bar, barsHeld, rules) {
  const ep = Number(avgEntry);
  if (!Number.isFinite(ep) || ep <= 0 || barsHeld < 1) return { action: 'none' };
  const hi = bar?.high != null ? Number(bar.high) : NaN;
  const lo = bar?.low != null ? Number(bar.low) : NaN;
  const cl = bar?.close != null ? Number(bar.close) : NaN;
  const stopPct = Number(rules.stopPct) > 0 ? Number(rules.stopPct) : 0.05;
  const targetPct = Number(rules.targetPct) > 0 ? Number(rules.targetPct) : 0.1;
  const targetPrice = ep * (1 + targetPct);
  const stopPrice = ep * (1 - stopPct);
  if (Number.isFinite(hi) && hi >= targetPrice) {
    return { action: 'close', price: targetPrice, reason: 'profit_target_simple' };
  }
  if (Number.isFinite(lo) && lo <= stopPrice) {
    return { action: 'close', price: stopPrice, reason: 'stop_loss_simple' };
  }
  if (
    rules.maxHoldingBars != null &&
    Number.isFinite(Number(rules.maxHoldingBars)) &&
    barsHeld >= Number(rules.maxHoldingBars)
  ) {
    return Number.isFinite(cl) ? { action: 'close', price: cl, reason: 'max_holding_bars' } : { action: 'none' };
  }
  const md =
    rules.maxHoldingDays != null && Number.isFinite(Number(rules.maxHoldingDays))
      ? Number(rules.maxHoldingDays)
      : 7;
  if (barsHeld >= md && Number.isFinite(cl)) {
    return { action: 'close', price: cl, reason: `max_holding_${md}d_simple` };
  }
  return { action: 'none' };
}

async function loadOhlcvForPaperExit(setupId, sym, rules, opts) {
  if (setupId === 'rsi-ma-setup-copy' || setupId === 'eighty-percent') {
    const series = rules?.series ?? (opts.series != null ? String(opts.series) : 'day');
    return loadRsiMaOhlcv(sym, series);
  }
  if (setupId === 'rsi-setup') {
    const tf = rules?.timeframe || String(opts.timeframe || 'day').trim();
    const candles = await getCandlesForSignal(sym, tf, 500);
    if (candles.length < 10) return { ok: false, error: `Insufficient candles (${candles.length})` };
    const ohlcv = candles.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0,
      time: c.time,
    }));
    return { ok: true, ohlcv };
  }
  if (setupId === 'ema-crossover') {
    const candles = await getCandlesForSignal(sym, '60minute', 500);
    if (candles.length < 10) return { ok: false, error: `Insufficient candles (${candles.length})` };
    const ohlcv = candles.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0,
      time: c.time,
    }));
    return { ok: true, ohlcv };
  }
  return { ok: false, error: 'Unsupported setup for auto exit' };
}

export async function tryPaperExitForOpenPosition(store, setupId, sym, opts) {
  const pos = store.getOpen(setupId, sym);
  if (!pos) return null;
  const rules = mergePaperRulesForExit(pos, setupId, opts);
  if (!rules?.kind) return null;

  const loaded = await loadOhlcvForPaperExit(setupId, sym, rules, opts);
  if (!loaded.ok) return null;

  const ohlcv = loaded.ohlcv;
  const lastIdx = ohlcv.length - 1;
  const lastBar = ohlcv[lastIdx];
  const barsHeld = barsHeldCount(ohlcv, rules.entryCandleTime, pos.openedAt);

  const exitSnap = async () => {
    const s = await evaluatePaperSetup(setupId, sym, opts);
    return s.error ? { setupId, symbol: sym, error: s.error } : s;
  };

  if (rules.kind === 'rsi-ma-setup-copy') {
    const ind = computeIndicatorSeries(ohlcv);
    const rsiNow =
      Array.isArray(ind.rsi) && ind.rsi[lastIdx] != null && Number.isFinite(Number(ind.rsi[lastIdx]))
        ? Number(ind.rsi[lastIdx])
        : NaN;
    const { actions } = resolveRsiMaCopyPaperIntrabarActions(
      {
        qty: pos.qty,
        totalCost: pos.qty * pos.entryPrice,
        partialTpDone: Boolean(rules.partialTpDone),
      },
      lastBar,
      rsiNow,
      barsHeld,
      {
        profitTargetPct: rules.profitTargetPct,
        rsiRemainderExit: rules.rsiRemainderExit,
        partialTpFraction: rules.partialTpFraction,
      },
    );

    let partialThisBar = null;
    for (const a of actions) {
      if (a.type === 'partial') {
        const p = store.partialCloseLong(setupId, sym, a.sellQty, a.price);
        if (!p.success) {
          return {
            ok: false,
            error: p.error,
            action: 'EXIT_ERROR',
            state: store.getState(),
          };
        }
        partialThisBar = { soldQty: p.soldQty, price: a.price };
        continue;
      }
      if (a.type === 'close') {
        const snap = await exitSnap();
        const closed = store.closeLong(setupId, sym, a.price, a.reason, snap);
        await persistAfterClose(store, closed.trade, snap);
        return {
          ok: closed.success,
          action: 'CLOSE',
          trade: closed.trade,
          error: closed.error,
          snapshot: snap,
          state: store.getState(),
        };
      }
    }

    if (partialThisBar && store.getOpen(setupId, sym)) {
      return {
        ok: true,
        action: 'PARTIAL',
        soldQty: partialThisBar.soldQty,
        price: partialThisBar.price,
        snapshot: await exitSnap(),
        state: store.getState(),
      };
    }

    const still = store.getOpen(setupId, sym);
    const maxD =
      rules.maxHoldingDays != null && Number.isFinite(Number(rules.maxHoldingDays))
        ? Number(rules.maxHoldingDays)
        : 7;
    if (still && barsHeld >= maxD) {
      const cl = lastBar?.close != null ? Number(lastBar.close) : NaN;
      if (Number.isFinite(cl) && cl > 0) {
        const snap = await exitSnap();
        const closed = store.closeLong(setupId, sym, cl, `max_holding_${maxD}d`, snap);
        await persistAfterClose(store, closed.trade, snap);
        return {
          ok: closed.success,
          action: 'CLOSE',
          trade: closed.trade,
          error: closed.error,
          snapshot: snap,
          state: store.getState(),
        };
      }
    }
    return null;
  }

  if (rules.kind === 'eighty-percent') {
    const d = resolveEightyPercentPaperBarAction(pos.entryPrice, lastBar, barsHeld, {
      maxHoldingDays: rules.maxHoldingDays,
    });
    if (d.action === 'close') {
      const snap = await exitSnap();
      const closed = store.closeLong(setupId, sym, d.price, d.reason, snap);
      await persistAfterClose(store, closed.trade, snap);
      return {
        ok: closed.success,
        action: 'CLOSE',
        trade: closed.trade,
        error: closed.error,
        snapshot: snap,
        state: store.getState(),
      };
    }
    return null;
  }

  if (rules.kind === 'simple') {
    const d = resolveSimplePaperBar(pos.entryPrice, lastBar, barsHeld, rules);
    if (d.action === 'close') {
      const snap = await exitSnap();
      const closed = store.closeLong(setupId, sym, d.price, d.reason, snap);
      await persistAfterClose(store, closed.trade, snap);
      return {
        ok: closed.success,
        action: 'CLOSE',
        trade: closed.trade,
        error: closed.error,
        snapshot: snap,
        state: store.getState(),
      };
    }
    return null;
  }

  return null;
}

/**
 * @param {import('./PaperTradingStore.js').PaperTradingStore} store
 */
export async function applyPaperTick(store, setupId, symbol, orderValueInr, opts = {}) {
  try {
    const sym = symTrim(symbol);

    if (store.getOpen(setupId, sym)) {
      const exitOut = await tryPaperExitForOpenPosition(store, setupId, sym, opts);
      if (exitOut) return exitOut;
      const holdSnap = await evaluatePaperSetup(setupId, sym, opts);
      if (holdSnap.error) {
        return { ok: false, error: holdSnap.error, snapshot: holdSnap, state: store.getState() };
      }
      return {
        ok: true,
        action: 'NONE',
        snapshot: holdSnap,
        message: 'Open position — skipped new entry until exit (SL / target / max hold / rules).',
        state: store.getState(),
      };
    }

    const snap = await evaluatePaperSetup(setupId, sym, opts);
    if (snap.error) {
      return { ok: false, error: snap.error, snapshot: snap };
    }

    const { priceForBuyOpen, priceForExit } = resolvePaperExecutionPrices(setupId, snap);

    const open = store.getOpen(setupId, sym);

    if (snap.signal_type === 'SELL' && open) {
      if (priceForExit == null || priceForExit <= 0) {
        return { ok: false, error: 'No usable price for paper execution.', snapshot: snap };
      }
      const closed = store.closeLong(setupId, symTrim(symbol), priceForExit, 'signal_sell', snap);
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
      if (priceForBuyOpen == null || priceForBuyOpen <= 0) {
        return { ok: false, error: 'No usable price for paper execution.', snapshot: snap };
      }
      const qty = qtyFromOrderValue(orderValueInr, priceForBuyOpen);
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
        symbol: sym,
        tradingsymbol: sym,
        qty,
        price: priceForBuyOpen,
        orderValueInr: Number(orderValueInr),
        snapshot: {
          ...snap,
          evaluatedAt: new Date().toISOString(),
        },
        paperRules: buildPaperRulesForOpen(setupId, snap, opts),
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
  } finally {
    await savePaperPortfolioState(store);
  }
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
  try {
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
  } finally {
    await savePaperPortfolioState(store);
  }
}

export function getPaperTradingState() {
  return paperTradingStore.getState();
}

export async function resetPaperTrading() {
  paperTradingStore.reset();
  await savePaperPortfolioState(paperTradingStore);
  return paperTradingStore.getState();
}

/**
 * Run SL / partial TP / RSI remainder / max-hold for every open paper position (daily job or manual).
 * Skips new entries; each symbol is only managed until flat.
 */
export async function runPaperTradingDailyBarExits(store = paperTradingStore) {
  const positions = [...store.positions.values()];
  const results = [];
  for (const pos of positions) {
    const sid = pos.setupId;
    const sym = pos.symbol;
    if (!sid || !sym) continue;
    try {
      const out = await tryPaperExitForOpenPosition(store, sid, sym, {});
      if (out) {
        results.push({
          setupId: sid,
          symbol: sym,
          action: out.action,
          ok: out.ok,
          error: out.error ?? null,
        });
      }
    } catch (err) {
      logger.warn('Paper daily exit skip', { setupId: sid, symbol: sym, error: err?.message ?? String(err) });
      results.push({ setupId: sid, symbol: sym, action: 'ERROR', ok: false, error: err?.message ?? String(err) });
    }
  }
  await savePaperPortfolioState(store);
  return { processed: positions.length, results };
}

/**
 * Run `applyPaperTick` for each auto-trading row (daily cron).
 * @param {import('./PaperTradingStore.js').PaperTradingStore} store
 * @param {Array<{ setupId: string, symbol: string, orderValueInr?: number }>} rows
 */
export async function runPaperTradingAutoTicks(store, rows) {
  const results = [];
  if (!Array.isArray(rows)) return results;
  for (const row of rows) {
    const setupId = String(row?.setupId || '').trim();
    const symbol = String(row?.symbol || '').trim();
    if (!setupId || !symbol) continue;
    const orderValueInr = row.orderValueInr != null ? Number(row.orderValueInr) : 10_000;
    const opts = {
      timeframe: row.timeframe,
      mode: row.mode,
      thresholds: row.thresholds,
      series: row.series,
      profitTargetPct: row.profitTargetPct,
      rsiRemainderExit: row.rsiRemainderExit,
      partialTpFraction: row.partialTpFraction,
      maxHoldingDays: row.maxHoldingDays,
      minStockPrice: row.minStockPrice,
      maxStockPrice: row.maxStockPrice,
    };
    try {
      const out = await applyPaperTick(store, setupId, symbol, orderValueInr, opts);
      results.push({ setupId, symbol, ...out });
    } catch (e) {
      results.push({ setupId, symbol, ok: false, error: e?.message ?? String(e) });
    }
  }
  return results;
}
