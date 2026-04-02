/**
 * RSI↓MA Setup — copy (1D):
 * Independent duplicate of `eightyPercentSetup.js` for tuning without changing the primary strategy.
 * Same rules: RSI < 40 (lowest bar low in that dip = entry) → RSI > 55 → RSI crosses down through RSI MA.
 */

import { computeIndicatorSeries } from './IndicatorService.js';

/** RSI must exceed this before a cross-down through MA qualifies (“returns from above 55”). */
export const RSI_ARM_LEVEL = 55;
export const RSI_PRECONDITION_LEVEL = 40;
/** Min close on the RSI cross-down bar (inclusive); bars below this are ignored. */
export const MIN_STOCK_PRICE = 20;
const MIN_BARS = 30;
const MAX_HOLDING_DAYS = 7;
const DEFAULT_BUY_AMOUNT = 1000;
/** Stop vs average cost while pyramid adds are still allowed (`pyramidAdds < MAX_PYRAMID_ADDS`). */
const STOP_LOSS_PCT = 0.05;
/** Stop vs average cost once max pyramid adds are used (no further adds). Often tighter than `STOP_LOSS_PCT`. */
const STOP_LOSS_AFTER_MAX_PYRAMID_PCT = 0.03;
/** Default fraction for first partial take-profit vs avg cost (e.g. 0.10 = +10%). Overridable via `runBacktest` options. */
export const RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PCT = 0.10;
/** Default RSI level (close-of-bar) to exit the remainder after partial TP. Overridable via `runBacktest` options. */
export const RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT = 70;
const PROFIT_TARGET_PCT = RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PCT;
const RSI_REMAINDER_EXIT = RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT;
/**
 * Default fraction of position sold at first take-profit (0.8 = 80%).
 * Use `1` or `100` (via `normalizePartialTpFraction`) for a full exit at that price — no remainder RSI leg.
 */
export const RSI_MA_COPY_DEFAULT_PARTIAL_TP_FRACTION = 0.8;

/**
 * @param {unknown} raw - omitted → default; number > 1 treated as percent (80 → 0.8, 100 → 1)
 * @returns {number} in (0, 1], capped at 1, floor min 0.01
 */
export function normalizePartialTpFraction(raw) {
  if (raw == null || raw === '') return RSI_MA_COPY_DEFAULT_PARTIAL_TP_FRACTION;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return RSI_MA_COPY_DEFAULT_PARTIAL_TP_FRACTION;
  const f = n > 1 ? n / 100 : n;
  if (!Number.isFinite(f) || f <= 0) return RSI_MA_COPY_DEFAULT_PARTIAL_TP_FRACTION;
  return Math.min(1, Math.max(0.01, f));
}
/**
 * Add when low ≤ avg × (1 − this). Keep **< `STOP_LOSS_PCT`** so add triggers on a shallower dip than stop;
 * intrabar order is TP → pyramid → stop (so equal % no longer skips adds).
 */
const PYRAMID_DIP_BELOW_AVG_PCT = 0.03;
const MAX_PYRAMID_ADDS = 0;

function isFiniteNumber(v) {
  return Number.isFinite(v);
}

/**
 * BUY when sequence is met:
 * 1) RSI dips below `precondition` (40), then
 * 2) RSI rises above `overbought` (55), then
 * 3) RSI crosses down through RSI MA (prev: RSI > MA, now: RSI <= MA).
 * Entry price = minimum bar `low` among bars where RSI is below `precondition`, from the latest cross
 * into below-precondition until RSI is back at or above precondition (then frozen until the pattern completes or resets).
 */
function findBuySetups(
  rsi,
  rsiSma,
  close,
  low,
  overbought = RSI_ARM_LEVEL,
  precondition = RSI_PRECONDITION_LEVEL,
  minPrice = MIN_STOCK_PRICE,
) {
  if (!Array.isArray(rsi) || !Array.isArray(rsiSma) || !Array.isArray(close) || rsi.length === 0) return [];
  const lowArr = Array.isArray(low) && low.length === close.length ? low : close;

  function barLow(idx) {
    if (isFiniteNumber(lowArr[idx])) return Number(lowArr[idx]);
    if (isFiniteNumber(close[idx])) return Number(close[idx]);
    return null;
  }

  const setups = [];
  let seenBelowPrecondition = false;
  let dipLowestLow = null;
  let armed = false;
  for (let i = 1; i < rsi.length; i++) {
    const rNow = rsi[i];
    const rPrev = rsi[i - 1];
    const mNow = rsiSma[i];
    const mPrev = rsiSma[i - 1];
    if (!isFiniteNumber(rNow) || !isFiniteNumber(rPrev)) continue;
    if (!isFiniteNumber(mNow) || !isFiniteNumber(mPrev)) continue;

    const dippedBelowPrecondition = rPrev >= precondition && rNow < precondition;
    if (dippedBelowPrecondition) {
      seenBelowPrecondition = true;
      dipLowestLow = barLow(i);
      armed = false;
    }

    if (seenBelowPrecondition && rNow < precondition) {
      const bl = barLow(i);
      if (isFiniteNumber(bl)) {
        dipLowestLow = dipLowestLow == null ? bl : Math.min(dipLowestLow, bl);
      }
    }

    if (seenBelowPrecondition && rNow > overbought) armed = true;

    const crossDownThroughMa = rPrev > mPrev && rNow <= mNow;
    const crossClose = close[i];
    const closeOk = isFiniteNumber(crossClose) && Number(crossClose) >= minPrice;
    const entryPx = isFiniteNumber(dipLowestLow) ? Number(dipLowestLow) : null;
    const entryOk = isFiniteNumber(entryPx) && entryPx >= minPrice;

    if (armed && crossDownThroughMa && closeOk && entryOk && entryPx > 0) {
      setups.push({
        entryIndex: i,
        entryPrice: entryPx,
        firstDipBelow40Close: entryPx,
        previousSwingLow: entryPx,
      });
      dipLowestLow = null;
      seenBelowPrecondition = false;
      armed = false;
    }
  }
  return setups;
}

/**
 * Evaluate RSI↓MA Setup (copy) on full OHLCV. Returns signal for the last bar only.
 * @param {Array<{ open, high, low, close, volume? }>} ohlcv - Candles oldest first
 * @returns {{ signal: 'BUY'|'HOLD', entryPrice?: number, previousSwingLow?: number, entryIndex?: number, explanation: string }}
 */
export function evaluate(ohlcv) {
  const n = Array.isArray(ohlcv) ? ohlcv.length : 0;
  if (!Array.isArray(ohlcv) || n < MIN_BARS) {
    return {
      signal: 'HOLD',
      explanation: `Insufficient daily bars for RSI↓MA copy (need ≥${MIN_BARS}, got ${n}). Sync NSE daily data for this symbol.`,
    };
  }

  const series = computeIndicatorSeries(ohlcv);
  const { close, low, rsi, rsiSma } = series;
  if (!close?.length || !rsi?.length || !rsiSma?.length) {
    return {
      signal: 'HOLD',
      explanation: 'Could not compute RSI / RSI MA on stored candles (missing or invalid OHLC).',
    };
  }

  const i = close.length - 1;
  const c = close[i];
  const r = rsi[i];
  if (!isFiniteNumber(c) || !isFiniteNumber(r)) {
    return { signal: 'HOLD', explanation: 'Latest bar has invalid close or RSI.' };
  }

  const setups = findBuySetups(
    rsi,
    rsiSma,
    close,
    low,
    RSI_ARM_LEVEL,
    RSI_PRECONDITION_LEVEL,
    MIN_STOCK_PRICE,
  );
  const lastSetup = setups.length > 0 ? setups[setups.length - 1] : null;
  if (lastSetup && lastSetup.entryIndex === i) {
    const entry = lastSetup.entryPrice;
    return {
      signal: 'BUY',
      entryPrice: entry,
      firstDipBelow40Close: entry,
      previousSwingLow: entry,
      entryIndex: i,
      explanation: `RSI↓MA Setup (copy): RSI dipped below ${RSI_PRECONDITION_LEVEL}, then rose above ${RSI_ARM_LEVEL}, then crossed down through RSI MA; entry at lowest low while RSI below ${RSI_PRECONDITION_LEVEL} ${entry.toFixed(2)} (RSI ${r.toFixed(1)}).`,
    };
  }

  if (lastSetup && lastSetup.entryIndex !== i) {
    const ago = i - lastSetup.entryIndex;
    return {
      signal: 'HOLD',
      explanation: `HOLD: BUY only on the cross-down bar (latest bar is not that bar; last copy-setup entry was ${ago} daily bar(s) ago). Re-run after a new session bar or if the live list was from before the latest candle.`,
    };
  }

  return {
    signal: 'HOLD',
    explanation:
      'No complete setup in range (need: RSI dip below 40 → rise above 55 → RSI crosses down through RSI MA, with min close filter).',
  };
}

/**
 * All BUY setups in the series (copy strategy; for backtest and multi-row signals).
 * @param {Array<{ open, high, low, close, volume?, time? }>} ohlcv - Candles oldest first
 * @returns {{ setups: Array<{ entryPrice: number, previousSwingLow: number, entryIndex: number }>, lastResult: object|null }}
 */
export function evaluateAllSetups(ohlcv) {
  const out = { setups: [], lastResult: null };
  if (!Array.isArray(ohlcv) || ohlcv.length < MIN_BARS) return out;

  const series = computeIndicatorSeries(ohlcv);
  const { close, low, rsi, rsiSma } = series;
  if (!close?.length || !rsi?.length || !rsiSma?.length) return out;

  const setups = findBuySetups(
    rsi,
    rsiSma,
    close,
    low,
    RSI_ARM_LEVEL,
    RSI_PRECONDITION_LEVEL,
    MIN_STOCK_PRICE,
  );
  for (const s of setups) out.setups.push(s);

  const last = evaluate(ohlcv);
  if (last.signal === 'BUY') out.lastResult = last;
  return out;
}

/**
 * Run RSI↓MA Setup (copy) backtest. Entry signals from evaluateAllSetups.
 * Copy-only position rules:
 * - Open with first-leg notional `buyAmount` at strategy entry (lowest low while RSI below 40); `lotShares` = that size / entry.
 * - Intrabar order: partial profit target (fraction of qty at avg × (1 + PROFIT_TARGET_PCT)); at 100% fraction, full exit at TP instead. Then pyramid add (if low hits dip), then stop.
 * - After partial TP: remaining shares exit when RSI ≥ RSI_REMAINDER_EXIT (bar close), or stop vs same avg, or max hold / EOD.
 * - Stop: avg × (1 − STOP_LOSS_PCT) until max pyramid adds are exhausted; then avg × (1 − STOP_LOSS_AFTER_MAX_PYRAMID_PCT). Else max hold / EOD.
 * @param {Array<{ open, high, low, close, volume?, time? }>} ohlcv - Candles oldest first
 */
export function runBacktest(ohlcv, options = {}) {
  const trades = [];
  let equity = 1;
  /** @type {null | { entryBar: number, firstDipBelow40Close: number, previousSwingLow: number, lotShares: number, totalQty: number, totalCost: number, pyramidAdds: number, firstEntryPrice: number, pyramidFillPrices: number[], partialExitMeta?: { investedFull: number, halfQty: number, avgAtPartial: number, tpPrice: number, partialBar: number } }} */
  let position = null;

  const seriesBt = computeIndicatorSeries(ohlcv);
  const rsiBt = seriesBt.rsi;

  const maxHoldingDays =
    options?.maxHoldingDays != null &&
    Number.isFinite(Number(options.maxHoldingDays)) &&
    Number(options.maxHoldingDays) >= 1
      ? Math.floor(Number(options.maxHoldingDays))
      : MAX_HOLDING_DAYS;
  const buyAmount =
    options?.buyAmount != null &&
    Number.isFinite(Number(options.buyAmount)) &&
    Number(options.buyAmount) > 0
      ? Number(options.buyAmount)
      : DEFAULT_BUY_AMOUNT;

  let profitTargetPct = PROFIT_TARGET_PCT;
  const rawPt = options?.profitTargetPct;
  if (rawPt != null && Number.isFinite(Number(rawPt)) && Number(rawPt) > 0) {
    let v = Number(rawPt);
    if (v > 1) v /= 100;
    profitTargetPct = Math.min(5, Math.max(0.005, v));
  }
  let rsiRemainderExit = RSI_REMAINDER_EXIT;
  const rawRsi = options?.rsiRemainderExit;
  if (rawRsi != null && Number.isFinite(Number(rawRsi))) {
    rsiRemainderExit = Math.min(95, Math.max(5, Math.round(Number(rawRsi))));
  }

  const partialTpFr = normalizePartialTpFraction(options?.partialTpFraction);

  const { setups } = evaluateAllSetups(ohlcv);
  const entryByBar = new Map();
  for (const s of setups) {
    if (s.entryIndex >= 0 && s.entryPrice != null) {
      entryByBar.set(s.entryIndex, {
        entryPrice: s.entryPrice,
        firstDipBelow40Close: s.firstDipBelow40Close ?? s.entryPrice,
        previousSwingLow: s.previousSwingLow ?? s.entryPrice,
      });
    }
  }

  const minBar = entryByBar.size > 0 ? Math.max(0, Math.min(...entryByBar.keys())) : ohlcv.length;

  function stopLossExitReason(pos) {
    if (MAX_PYRAMID_ADDS <= 0) return 'stop_loss_avg';
    if (pos.pyramidAdds >= MAX_PYRAMID_ADDS) return 'stop_loss_avg_after_max_adds';
    return 'stop_loss_avg_initial_leg';
  }

  function closePosition(exitBarIdx, exitPrice, exitReason) {
    if (!position) return;
    const c = ohlcv[exitBarIdx];
    const meta = position.partialExitMeta;
    const pnlRemainder = exitPrice * position.totalQty - position.totalCost;
    equity *= position.totalCost > 0 ? 1 + pnlRemainder / position.totalCost : 1;

    let avgEntry;
    let pnl;
    let investedForPct;
    let qtyForRow;
    let finalReason = exitReason;
    if (meta) {
      const { investedFull, halfQty, avgAtPartial, tpPrice } = meta;
      const pnlPartial = halfQty * (tpPrice - avgAtPartial);
      pnl = pnlPartial + pnlRemainder;
      investedForPct = investedFull;
      avgEntry = avgAtPartial;
      qtyForRow = halfQty + position.totalQty;
      if (exitReason === 'rsi_remainder_exit') {
        finalReason = `profit_target_half_then_rsi_${rsiRemainderExit}`;
      }
      else if (exitReason.startsWith('stop_loss')) finalReason = `profit_target_half_then_${exitReason}`;
      else if (exitReason.startsWith('max_holding')) finalReason = `profit_target_half_then_${exitReason}`;
      else if (exitReason === 'eod') finalReason = 'profit_target_half_then_eod';
    } else {
      avgEntry = position.totalCost / position.totalQty;
      pnl = pnlRemainder;
      investedForPct = position.totalCost;
      qtyForRow = position.totalQty;
    }

    const profitPercent = investedForPct !== 0 ? (pnl / investedForPct) * 100 : null;
    const barsHeld = exitBarIdx - position.entryBar;
    const fills = Array.isArray(position.pyramidFillPrices) ? position.pyramidFillPrices : [];
    const secondEntryPrice = fills.length > 0 ? fills[0] : null;
    const entryCandle = ohlcv[position.entryBar];
    trades.push({
      entryBar: position.entryBar,
      exitBar: exitBarIdx,
      entryPrice: avgEntry,
      firstEntryPrice: position.firstEntryPrice ?? avgEntry,
      secondEntryPrice,
      pyramidFillPrices: fills.length > 0 ? [...fills] : undefined,
      firstDipBelow40Close: position.firstDipBelow40Close,
      previousSwingLow: position.previousSwingLow,
      exitPrice,
      partialTpPrice: meta?.tpPrice,
      partialTpBar: meta?.partialBar,
      quantity: qtyForRow,
      lotShares: position.lotShares,
      pyramidAdds: position.pyramidAdds,
      investedAmount: investedForPct,
      entryTime: entryCandle?.time ?? null,
      exitTime: c?.time ?? null,
      exitReason: finalReason,
      pnl,
      profitPercent: profitPercent != null ? Math.round(profitPercent * 100) / 100 : null,
      holdingPeriodDays: barsHeld,
    });
    position = null;
  }

  function partialExitAtTp(i, tp) {
    if (!position || position.partialExitMeta) return;
    const investedFull = position.totalCost;
    const qtyFull = position.totalQty;
    if (!Number.isFinite(investedFull) || investedFull <= 0 || !Number.isFinite(qtyFull) || qtyFull <= 0) return;
    const avgAtPartial = investedFull / qtyFull;
    const halfQty = qtyFull * partialTpFr;
    if (!Number.isFinite(halfQty) || halfQty <= 0) return;
    const pnlPart = halfQty * (tp - avgAtPartial);
    equity *= investedFull > 0 ? 1 + pnlPart / investedFull : 1;
    position.totalQty = qtyFull - halfQty;
    position.totalCost = position.totalQty * avgAtPartial;
    position.partialExitMeta = {
      investedFull,
      halfQty,
      avgAtPartial,
      tpPrice: tp,
      partialBar: i,
    };
  }

  /** Intrabar: partial target first, then pyramid (before stop), then stop — re-evaluate after each add. After partial TP, remainder: stop then RSI remainder exit at close. */
  function processOpenBar(i) {
    if (!position) return;
    const c = ohlcv[i];
    const barsHeld = i - position.entryBar;

    const hi = c.high != null ? Number(c.high) : NaN;
    const lo = c.low != null ? Number(c.low) : NaN;
    const rsiNow = Array.isArray(rsiBt) && rsiBt[i] != null ? Number(rsiBt[i]) : NaN;
    if (i <= position.entryBar) return;

    let guard = 0;
    while (guard < 24 && position) {
      guard += 1;
      const avg = position.totalCost / position.totalQty;
      const tp = avg * (1 + profitTargetPct);
      const slPct =
        position.pyramidAdds >= MAX_PYRAMID_ADDS ? STOP_LOSS_AFTER_MAX_PYRAMID_PCT : STOP_LOSS_PCT;
      const sl = avg * (1 - slPct);
      const dipFill = avg * (1 - PYRAMID_DIP_BELOW_AVG_PCT);

      if (position.partialExitMeta) {
        if (Number.isFinite(lo) && lo <= sl) {
          closePosition(i, sl, stopLossExitReason(position));
          return;
        }
        if (Number.isFinite(rsiNow) && rsiNow >= rsiRemainderExit) {
          closePosition(i, Number(c.close), 'rsi_remainder_exit');
          return;
        }
        break;
      }

      if (Number.isFinite(hi) && hi >= tp) {
        if (partialTpFr >= 1) {
          closePosition(i, tp, 'profit_target_full');
          return;
        }
        partialExitAtTp(i, tp);
        continue;
      }
      if (
        position.pyramidAdds < MAX_PYRAMID_ADDS &&
        Number.isFinite(lo) &&
        lo <= dipFill
      ) {
        position.totalCost += dipFill * position.lotShares;
        position.totalQty += position.lotShares;
        position.pyramidFillPrices.push(dipFill);
        position.pyramidAdds += 1;
        continue;
      }
      if (Number.isFinite(lo) && lo <= sl) {
        closePosition(i, sl, stopLossExitReason(position));
        return;
      }
      break;
    }

    if (position && barsHeld >= maxHoldingDays) {
      closePosition(i, Number(c.close), `max_holding_${maxHoldingDays}d`);
    }
  }

  for (let i = minBar; i < ohlcv.length; i++) {
    const c = ohlcv[i];

    if (position) {
      processOpenBar(i);
      if (position) continue;
    }

    if (!position && entryByBar.has(i)) {
      const ent = entryByBar.get(i);
      const entryPx = Number(ent.entryPrice);
      if (!Number.isFinite(entryPx) || entryPx <= 0) continue;
      const lotShares = buyAmount / entryPx;
      if (!Number.isFinite(lotShares) || lotShares <= 0) continue;
      position = {
        entryBar: i,
        firstDipBelow40Close: ent.firstDipBelow40Close ?? entryPx,
        previousSwingLow: ent.previousSwingLow ?? entryPx,
        lotShares,
        totalQty: lotShares,
        totalCost: entryPx * lotShares,
        pyramidAdds: 0,
        firstEntryPrice: entryPx,
        pyramidFillPrices: [],
        partialExitMeta: undefined,
      };
    }
  }

  if (position) {
    const last = ohlcv[ohlcv.length - 1];
    const lastClose = Number(last?.close);
    const exitPx = Number.isFinite(lastClose) ? lastClose : position.totalCost / position.totalQty;
    closePosition(ohlcv.length - 1, exitPx, 'eod');
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  return {
    trades,
    tradesCount: trades.length,
    winRate: trades.length > 0 ? wins / trades.length : 0,
    totalReturn: equity - 1,
    avgR: 0,
    maxHoldingDays,
    buyAmount,
    minStockPrice: MIN_STOCK_PRICE,
    pyramidDipBelowAvgPct: PYRAMID_DIP_BELOW_AVG_PCT,
    maxPyramidAdds: MAX_PYRAMID_ADDS,
    stopLossPct: STOP_LOSS_PCT,
    stopLossAfterMaxPyramidPct: STOP_LOSS_AFTER_MAX_PYRAMID_PCT,
    profitTargetPct,
    partialTpFraction: partialTpFr,
    rsiRemainderExit,
  };
}

/**
 * SL and first partial TP from average entry, matching `runBacktest` / `processOpenBar` before partial exit.
 * With `MAX_PYRAMID_ADDS === 0`, initial stop uses `STOP_LOSS_AFTER_MAX_PYRAMID_PCT` (same as `pyramidAdds >= MAX_PYRAMID_ADDS`).
 * @param {number} avgEntry
 * @param {{ profitTargetPct?: number, rsiRemainderExit?: number }} [options] — same normalization as runBacktest (profit % can be 10 or 0.10)
 */
/**
 * Intrabar actions for one bar, aligned with `runBacktest` / `processOpenBar` (pyramid adds disabled).
 * `barsHeld` = index distance from entry bar to this bar (0 on entry day → no intrabar exits).
 * Max-holding exit is applied by the caller after intrabar actions (see `runBacktest`).
 *
 * @param {{ qty: number, totalCost: number, partialTpDone: boolean }} state
 * @param {{ high?: number, low?: number, close?: number }} bar
 * @param {number} rsiNow
 * @param {number} barsHeld
 * @param {{ profitTargetPct?: number, rsiRemainderExit?: number }} [options]
 * @returns {{ actions: Array<{ type: 'partial', sellQty: number, price: number } | { type: 'close', price: number, reason: string }> }}
 */
export function resolveRsiMaCopyPaperIntrabarActions(state, bar, rsiNow, barsHeld, options = {}) {
  const actions = [];
  if (!state || barsHeld < 1) return { actions };

  let profitTargetPct = PROFIT_TARGET_PCT;
  const rawPt = options?.profitTargetPct;
  if (rawPt != null && Number.isFinite(Number(rawPt)) && Number(rawPt) > 0) {
    let v = Number(rawPt);
    if (v > 1) v /= 100;
    profitTargetPct = Math.min(5, Math.max(0.005, v));
  }

  let rsiRemainderExit = RSI_REMAINDER_EXIT;
  const rawRsi = options?.rsiRemainderExit;
  if (rawRsi != null && Number.isFinite(Number(rawRsi))) {
    rsiRemainderExit = Math.min(95, Math.max(5, Math.round(Number(rawRsi))));
  }

  const partialTpFr = normalizePartialTpFraction(options?.partialTpFraction);

  const hi = bar?.high != null ? Number(bar.high) : NaN;
  const lo = bar?.low != null ? Number(bar.low) : NaN;
  const cl = bar?.close != null ? Number(bar.close) : NaN;

  let qty = Math.floor(Number(state.qty));
  let totalCost = Number(state.totalCost);
  let partialTpDone = Boolean(state.partialTpDone);
  if (!Number.isFinite(qty) || qty < 1 || !Number.isFinite(totalCost) || totalCost <= 0) {
    return { actions };
  }

  let guard = 0;
  while (guard < 24 && qty >= 1) {
    guard += 1;
    const avg = totalCost / qty;
    const tp = avg * (1 + profitTargetPct);
    const slPct = 0 >= MAX_PYRAMID_ADDS ? STOP_LOSS_AFTER_MAX_PYRAMID_PCT : STOP_LOSS_PCT;
    const sl = avg * (1 - slPct);

    if (partialTpDone) {
      if (Number.isFinite(lo) && lo <= sl) {
        actions.push({ type: 'close', price: sl, reason: 'stop_loss_avg_after_max_adds' });
        break;
      }
      if (Number.isFinite(rsiNow) && rsiNow >= rsiRemainderExit && Number.isFinite(cl)) {
        actions.push({
          type: 'close',
          price: cl,
          reason: `profit_target_partial_then_rsi_${rsiRemainderExit}`,
        });
        break;
      }
      break;
    }

    if (Number.isFinite(hi) && hi >= tp) {
      if (partialTpFr >= 1) {
        actions.push({ type: 'close', price: tp, reason: 'profit_target_full' });
        break;
      }
      let sellQty = Math.floor(qty * partialTpFr);
      if (sellQty < 1) {
        actions.push({ type: 'close', price: tp, reason: 'profit_target_full_bar' });
        break;
      }
      actions.push({ type: 'partial', sellQty, price: tp });
      totalCost -= sellQty * avg;
      qty -= sellQty;
      partialTpDone = true;
      continue;
    }

    if (Number.isFinite(lo) && lo <= sl) {
      actions.push({ type: 'close', price: sl, reason: 'stop_loss_avg_after_max_adds' });
      break;
    }
    break;
  }

  return { actions };
}

export function planRsiMaCopyTradeLevels(avgEntry, options = {}) {
  const avg = Number(avgEntry);
  if (!Number.isFinite(avg) || avg <= 0) return null;

  let profitTargetPct = PROFIT_TARGET_PCT;
  const rawPt = options?.profitTargetPct;
  if (rawPt != null && Number.isFinite(Number(rawPt)) && Number(rawPt) > 0) {
    let v = Number(rawPt);
    if (v > 1) v /= 100;
    profitTargetPct = Math.min(5, Math.max(0.005, v));
  }

  let rsiRemainderExit = RSI_REMAINDER_EXIT;
  const rawRsi = options?.rsiRemainderExit;
  if (rawRsi != null && Number.isFinite(Number(rawRsi))) {
    rsiRemainderExit = Math.min(95, Math.max(5, Math.round(Number(rawRsi))));
  }

  const partialTpFr = normalizePartialTpFraction(options?.partialTpFraction);

  const pyramidAdds = 0;
  const slPct = pyramidAdds >= MAX_PYRAMID_ADDS ? STOP_LOSS_AFTER_MAX_PYRAMID_PCT : STOP_LOSS_PCT;
  const slPrice = avg * (1 - slPct);
  const partialTpPrice = avg * (1 + profitTargetPct);

  const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

  return {
    stopLossPrice: round2(slPrice),
    partialTakeProfitPrice: round2(partialTpPrice),
    stopLossPct: Math.round(slPct * 10000) / 100,
    partialTakeProfitPct: Math.round(profitTargetPct * 10000) / 100,
    rsiRemainderExit,
    partialTpFraction: partialTpFr,
  };
}

export default {
  evaluate,
  evaluateAllSetups,
  runBacktest,
  resolveRsiMaCopyPaperIntrabarActions,
  planRsiMaCopyTradeLevels,
  normalizePartialTpFraction,
  MIN_STOCK_PRICE,
  RSI_ARM_LEVEL,
  RSI_PRECONDITION_LEVEL,
  RSI_MA_COPY_DEFAULT_PARTIAL_TP_FRACTION,
};
