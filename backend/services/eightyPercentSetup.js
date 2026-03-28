/**
 * 80% Setup (1D):
 * After RSI first dips below 40 and then rises above 55, BUY when RSI crosses down through the RSI MA
 * (SMA of RSI, same period as RSI). Entry = close of the first dip-below-40 bar.
 */

import { computeIndicatorSeries } from './IndicatorService.js';

/** RSI must exceed this before a cross-down through MA qualifies (“returns from above 55”). */
export const RSI_ARM_LEVEL = 55;
export const RSI_PRECONDITION_LEVEL = 40;
/** Min close on the signal bar. */
export const MIN_STOCK_PRICE = 10;
const MIN_BARS = 30;
const MAX_HOLDING_DAYS = 7;
const DEFAULT_BUY_AMOUNT = 1000;
const STOP_LOSS_PCT = 0.05;
const PROFIT_TARGET_PCT = 0.10;

function isFiniteNumber(v) {
  return Number.isFinite(v);
}

/**
 * BUY when sequence is met:
 * 1) RSI dips below `precondition` (40), then
 * 2) RSI rises above `overbought` (55), then
 * 3) RSI crosses down through RSI MA (prev: RSI > MA, now: RSI <= MA).
 * Entry price = close on the first bar that dips below `precondition`.
 */
function findBuySetups(
  rsi,
  rsiSma,
  close,
  overbought = RSI_ARM_LEVEL,
  precondition = RSI_PRECONDITION_LEVEL,
  minPrice = MIN_STOCK_PRICE,
) {
  if (!Array.isArray(rsi) || !Array.isArray(rsiSma) || !Array.isArray(close) || rsi.length === 0) return [];
  const setups = [];
  let seenBelowPrecondition = false;
  let preconditionEntryPrice = null;
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
      preconditionEntryPrice = isFiniteNumber(close[i]) ? Number(close[i]) : null;
      armed = false;
    }

    if (seenBelowPrecondition && rNow > overbought) armed = true;

    const crossDownThroughMa = rPrev > mPrev && rNow <= mNow;
    const crossClose = close[i];
    const closeOk = isFiniteNumber(crossClose) && Number(crossClose) > minPrice;
    const entryPx = isFiniteNumber(preconditionEntryPrice) ? Number(preconditionEntryPrice) : null;

    if (armed && crossDownThroughMa && closeOk && isFiniteNumber(entryPx) && entryPx > 0) {
      setups.push({
        entryIndex: i,
        entryPrice: entryPx,
        firstDipBelow40Close: entryPx,
        previousSwingLow: entryPx,
      });
      preconditionEntryPrice = null;
      seenBelowPrecondition = false;
      armed = false;
    }
  }
  return setups;
}

/**
 * Evaluate 80% Setup on full OHLCV. Returns signal for the last bar only.
 * @param {Array<{ open, high, low, close, volume? }>} ohlcv - Candles oldest first
 * @returns {{ signal: 'BUY'|'HOLD', entryPrice?: number, previousSwingLow?: number, entryIndex?: number, explanation: string }}
 */
export function evaluate(ohlcv) {
  const empty = { signal: 'HOLD', explanation: 'Insufficient data or no setup.' };
  if (!Array.isArray(ohlcv) || ohlcv.length < MIN_BARS) return empty;

  const series = computeIndicatorSeries(ohlcv);
  const { close, rsi, rsiSma } = series;
  if (!close?.length || !rsi?.length || !rsiSma?.length) return empty;

  const i = close.length - 1;
  const c = close[i];
  const r = rsi[i];
  if (!isFiniteNumber(c) || !isFiniteNumber(r)) return empty;

  const setups = findBuySetups(rsi, rsiSma, close, RSI_ARM_LEVEL, RSI_PRECONDITION_LEVEL, MIN_STOCK_PRICE);
  const lastSetup = setups.length > 0 ? setups[setups.length - 1] : null;
  if (lastSetup && lastSetup.entryIndex === i) {
    const entry = lastSetup.entryPrice;
    return {
      signal: 'BUY',
      entryPrice: entry,
      firstDipBelow40Close: entry,
      previousSwingLow: entry,
      entryIndex: i,
      explanation: `80% Setup: RSI dipped below ${RSI_PRECONDITION_LEVEL}, then rose above ${RSI_ARM_LEVEL}, then crossed down through RSI MA; entry at first dip-below-${RSI_PRECONDITION_LEVEL} close ${entry.toFixed(2)} (RSI ${r.toFixed(1)}).`,
    };
  }
  return empty;
}

/**
 * All BUY setups in the series (for backtest and multi-row signals).
 * @param {Array<{ open, high, low, close, volume?, time? }>} ohlcv - Candles oldest first
 * @returns {{ setups: Array<{ entryPrice: number, previousSwingLow: number, entryIndex: number }>, lastResult: object|null }}
 */
export function evaluateAllSetups(ohlcv) {
  const out = { setups: [], lastResult: null };
  if (!Array.isArray(ohlcv) || ohlcv.length < MIN_BARS) return out;

  const series = computeIndicatorSeries(ohlcv);
  const { close, rsi, rsiSma } = series;
  if (!close?.length || !rsi?.length || !rsiSma?.length) return out;

  const setups = findBuySetups(rsi, rsiSma, close, RSI_ARM_LEVEL, RSI_PRECONDITION_LEVEL, MIN_STOCK_PRICE);
  for (const s of setups) out.setups.push(s);

  const last = evaluate(ohlcv);
  if (last.signal === 'BUY') out.lastResult = last;
  return out;
}

/**
 * Run 80% Setup backtest. Uses same entry logic as evaluateAllSetups.
 * Exit policy:
 * - profit target: 5% above entry (intrabar high touch)
 * - stop loss: 5% below entry (intrabar low breach)
 * - otherwise hold until maxHoldingDays is reached, then exit on that bar close
 * - or EOD fallback if data ends earlier
 * @param {Array<{ open, high, low, close, volume?, time? }>} ohlcv - Candles oldest first
 */
export function runBacktest(ohlcv, options = {}) {
  const trades = [];
  let equity = 1;
  const position = { entryBar: -1, entryPrice: 0, quantity: 0, previousSwingLow: null, firstDipBelow40Close: null };

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

  for (let i = minBar; i < ohlcv.length; i++) {
    const c = ohlcv[i];

    if (position.entryBar >= 0) {
      const barsHeld = i - position.entryBar;
      const stopPrice = position.entryPrice * (1 - STOP_LOSS_PCT);
      const targetPrice = position.entryPrice * (1 + PROFIT_TARGET_PCT);
      let exitPrice = c.close;
      let exitReason = null;
      if (
        i > position.entryBar &&
        c.high != null &&
        Number.isFinite(Number(c.high)) &&
        Number(c.high) >= targetPrice
      ) {
        exitReason = 'profit_target_5pct';
        exitPrice = targetPrice;
      }
      if (
        !exitReason &&
        i > position.entryBar &&
        c.low != null &&
        Number.isFinite(Number(c.low)) &&
        Number(c.low) <= stopPrice
      ) {
        exitReason = 'stop_loss_5pct';
        exitPrice = stopPrice;
      }
      if (!exitReason && barsHeld >= maxHoldingDays) exitReason = `max_holding_${maxHoldingDays}d`;

      if (exitReason) {
        const pnl = (exitPrice - position.entryPrice) * position.quantity;
        equity *= 1 + pnl / buyAmount;
        const entryCandle = ohlcv[position.entryBar];
        const profitPercent = buyAmount !== 0 ? (pnl / buyAmount) * 100 : null;
        trades.push({
          entryBar: position.entryBar,
          exitBar: i,
          entryPrice: position.entryPrice,
          firstDipBelow40Close: position.firstDipBelow40Close,
          previousSwingLow: position.previousSwingLow,
          exitPrice,
          quantity: position.quantity,
          investedAmount: buyAmount,
          entryTime: entryCandle?.time ?? null,
          exitTime: c?.time ?? null,
          exitReason,
          pnl,
          profitPercent: profitPercent != null ? Math.round(profitPercent * 100) / 100 : null,
          holdingPeriodDays: barsHeld,
        });
        position.entryBar = -1;
        position.quantity = 0;
        position.firstDipBelow40Close = null;
        position.previousSwingLow = null;
      }
      if (position.entryBar >= 0) continue;
    }

    if (position.entryBar < 0 && entryByBar.has(i)) {
      const ent = entryByBar.get(i);
      position.entryBar = i;
      position.entryPrice = ent.entryPrice;
      position.firstDipBelow40Close = ent.firstDipBelow40Close ?? ent.entryPrice;
      position.previousSwingLow = ent.previousSwingLow;
      position.quantity = position.entryPrice > 0 ? buyAmount / position.entryPrice : 0;
    }
  }

  if (position.entryBar >= 0) {
    const last = ohlcv[ohlcv.length - 1];
    const entryCandle = ohlcv[position.entryBar];
    const pnl = (last.close - position.entryPrice) * position.quantity;
    const profitPercent = buyAmount !== 0 ? (pnl / buyAmount) * 100 : null;
    trades.push({
      entryBar: position.entryBar,
      exitBar: ohlcv.length - 1,
      entryPrice: position.entryPrice,
      firstDipBelow40Close: position.firstDipBelow40Close,
      previousSwingLow: position.previousSwingLow,
      exitPrice: last.close,
      quantity: position.quantity,
      investedAmount: buyAmount,
      entryTime: entryCandle?.time ?? null,
      exitTime: last?.time ?? null,
      exitReason: 'eod',
      pnl,
      profitPercent: profitPercent != null ? Math.round(profitPercent * 100) / 100 : null,
      holdingPeriodDays: ohlcv.length - 1 - position.entryBar,
    });
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
  };
}

export default {
  evaluate,
  evaluateAllSetups,
  runBacktest,
  MIN_STOCK_PRICE,
  RSI_ARM_LEVEL,
  RSI_PRECONDITION_LEVEL,
};
