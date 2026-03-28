/**
 * RSI Setup backtest simulation.
 * Entry: evaluateAllSetups.
 * Exits: (0) stop if low ≤ pullback_low * (1 − stopLossFromPullbackLowPct);
 *         (1) 70% @ rebound day high when high ≥ that price;
 *         (2) remaining @ RSI ≥ 70, max holding, or EOD.
 */

import { evaluateAllSetups, formatRsiMomentumResetExplanation } from './SwingStrategyEngine.js';
import { computeIndicatorSeries } from '../IndicatorService.js';
import { RSI_SETUP_CONFIG } from './config.js';

/** Fraction scaled out when price retests rebound day high */
const REBOUND_PARTIAL_FRACTION = 0.7;

function buildExitExplanation(setupMeta, exitPrice, exitReason, maxHoldingDays) {
  if (setupMeta == null) return null;
  return formatRsiMomentumResetExplanation({
    peakPrice: setupMeta.peakPrice,
    low1Price: setupMeta.low1Price,
    preReboundLowPrice: setupMeta.preReboundLowPrice,
    reboundPrice: setupMeta.reboundPrice,
    entryPrice: setupMeta.entryPrice,
    exitPrice,
    exitReason:
      exitReason === 'setup_complete'
        ? 'setup_complete'
        : exitReason === 'max_holding'
          ? 'max_holding'
          : exitReason === 'rebound_partial_70'
            ? 'rebound_partial_70'
            : exitReason === 'eod'
              ? 'eod'
              : exitReason === 'stop_pullback_low'
                ? 'stop_pullback_low'
                : undefined,
    maxHoldingDays: exitReason === 'max_holding' ? maxHoldingDays : undefined,
    stopLossFromPullbackLowPct:
      exitReason === 'stop_pullback_low' ? RSI_SETUP_CONFIG.stopLossFromPullbackLowPct : undefined,
  });
}

/**
 * Run RSI Setup backtest on a single symbol's OHLCV.
 * @param {Array<{ open, high, low, close, volume?, time? }>} ohlcv - Candles oldest first
 * @param {{ maxHoldingDays?: number|null, mode?: 'strict'|'lenient'|string, thresholds?: { low1Min?: number, low1Max?: number, reboundMin?: number, reboundMax?: number } }} [options]
 */
export function runRsiSetupBacktest(ohlcv, options = {}) {
  const maxHoldingDays =
    options.maxHoldingDays != null &&
    Number.isFinite(Number(options.maxHoldingDays)) &&
    Number(options.maxHoldingDays) >= 1
      ? Math.floor(Number(options.maxHoldingDays))
      : null;
  const stopLossPct =
    RSI_SETUP_CONFIG.stopLossFromPullbackLowPct != null &&
    Number.isFinite(Number(RSI_SETUP_CONFIG.stopLossFromPullbackLowPct)) &&
    Number(RSI_SETUP_CONFIG.stopLossFromPullbackLowPct) > 0
      ? Number(RSI_SETUP_CONFIG.stopLossFromPullbackLowPct)
      : 0.03;
  const trades = [];
  let equity = 1;

  const emptyPosition = () => ({
    entryBar: -1,
    entryPrice: 0,
    remainingFraction: 1,
    reboundPrice: null,
    partialAtReboundDone: false,
  });
  let position = emptyPosition();

  const mode = options?.mode;
  const thresholds = options?.thresholds ?? {};
  const { setups } = evaluateAllSetups(ohlcv, { mode, thresholds });
  /** Every pattern the state machine fired (independent of backtest position overlap). */
  const allSetups = setups
    .filter((s) => s.entryIndex >= 0 && s.entryPrice != null)
    .map((s) => ({
      entryBar: s.entryIndex,
      entryTime: ohlcv[s.entryIndex]?.time ?? null,
      entryPrice: s.entryPrice,
      confidenceLabel: s.confidenceLabel ?? null,
      confidenceScore:
        s.confidenceScore != null && Number.isFinite(Number(s.confidenceScore))
          ? Number(s.confidenceScore)
          : null,
    }));
  const setupByEntryBar = new Map();
  const entryByBar = new Map();
  for (const s of setups) {
    if (s.entryIndex >= 0 && s.entryPrice != null) {
      entryByBar.set(s.entryIndex, s.entryPrice);
      setupByEntryBar.set(s.entryIndex, s);
    }
  }

  const minBar = entryByBar.size > 0 ? Math.max(0, Math.min(...entryByBar.keys())) : ohlcv.length;

  for (let i = minBar; i < ohlcv.length; i++) {
    const c = ohlcv[i];

    if (position.entryBar >= 0) {
      const setupMeta = setupByEntryBar.get(position.entryBar);
      const entryPx = position.entryPrice;
      const barsHeld = i - position.entryBar;
      const window = ohlcv.slice(0, i + 1);
      const windowSeries = computeIndicatorSeries(window);
      const rsiNow = windowSeries.rsi?.[i];

      const pullLow =
        setupMeta?.preReboundLowPrice != null && Number.isFinite(Number(setupMeta.preReboundLowPrice))
          ? Number(setupMeta.preReboundLowPrice)
          : null;
      const stopPrice =
        pullLow != null && pullLow > 0 ? pullLow * (1 - stopLossPct) : null;

      const remAtBarStart = position.remainingFraction;

      // Stop: remaining size exits at stop if bar low breaches (before rebound partial this bar)
      if (
        stopPrice != null &&
        remAtBarStart > 0 &&
        i > position.entryBar &&
        c.low != null &&
        Number.isFinite(Number(c.low)) &&
        Number(c.low) <= stopPrice
      ) {
        const exitPrice = stopPrice;
        const pnl = remAtBarStart * (exitPrice - entryPx);
        equity *= 1 + pnl / entryPx;
        const entryCandle = ohlcv[position.entryBar];
        const exitCandle = ohlcv[i];
        const profitPercent = entryPx !== 0 ? ((exitPrice - entryPx) / entryPx) * 100 : null;
        trades.push({
          entryBar: position.entryBar,
          exitBar: i,
          entryPrice: entryPx,
          exitPrice,
          entryTime: entryCandle?.time ?? null,
          exitTime: exitCandle?.time ?? null,
          exitReason: 'stop_pullback_low',
          pnl,
          profitPercent: profitPercent != null ? Math.round(profitPercent * 100) / 100 : null,
          holdingPeriodDays: barsHeld,
          positionFraction: remAtBarStart,
          stopTriggerPrice: stopPrice,
          pullbackLowRef: pullLow,
          confidenceLabel: setupMeta?.confidenceLabel ?? null,
          confidenceScore:
            setupMeta?.confidenceScore != null && Number.isFinite(Number(setupMeta.confidenceScore))
              ? Number(setupMeta.confidenceScore)
              : null,
          explanation: buildExitExplanation(setupMeta, exitPrice, 'stop_pullback_low', maxHoldingDays),
        });
        position = emptyPosition();
        continue;
      }

      // 70% @ rebound day high when touched (not on entry bar)
      if (
        !position.partialAtReboundDone &&
        position.reboundPrice != null &&
        Number.isFinite(position.reboundPrice) &&
        i > position.entryBar &&
        c.high != null &&
        Number.isFinite(Number(c.high)) &&
        Number(c.high) >= position.reboundPrice
      ) {
        const frac = REBOUND_PARTIAL_FRACTION;
        const exitPrice = position.reboundPrice;
        const pnl = frac * (exitPrice - entryPx);
        equity *= 1 + pnl / entryPx;
        const entryCandle = ohlcv[position.entryBar];
        const exitCandle = ohlcv[i];
        const profitPercent = entryPx !== 0 ? ((exitPrice - entryPx) / entryPx) * 100 : null;
        trades.push({
          entryBar: position.entryBar,
          exitBar: i,
          entryPrice: entryPx,
          exitPrice,
          entryTime: entryCandle?.time ?? null,
          exitTime: exitCandle?.time ?? null,
          exitReason: 'rebound_partial_70',
          pnl,
          profitPercent: profitPercent != null ? Math.round(profitPercent * 100) / 100 : null,
          holdingPeriodDays: barsHeld,
          positionFraction: frac,
          confidenceLabel: setupMeta?.confidenceLabel ?? null,
          confidenceScore:
            setupMeta?.confidenceScore != null && Number.isFinite(Number(setupMeta.confidenceScore))
              ? Number(setupMeta.confidenceScore)
              : null,
          explanation: buildExitExplanation(setupMeta, exitPrice, 'rebound_partial_70', maxHoldingDays),
        });
        position.remainingFraction = 1 - frac;
        position.partialAtReboundDone = true;
      }

      const rem = position.remainingFraction;
      if (rem <= 0) {
        position = emptyPosition();
        continue;
      }

      let exitReason = null;
      const exitPrice = c.close;
      if (rsiNow != null && rsiNow >= 70) {
        exitReason = 'setup_complete';
      }
      if (!exitReason && maxHoldingDays != null && barsHeld >= maxHoldingDays) {
        exitReason = 'max_holding';
      }

      if (exitReason) {
        const pnl = rem * (exitPrice - entryPx);
        equity *= 1 + pnl / entryPx;
        const entryCandle = ohlcv[position.entryBar];
        const exitCandle = ohlcv[i];
        const profitPercent = entryPx !== 0 ? ((exitPrice - entryPx) / entryPx) * 100 : null;
        trades.push({
          entryBar: position.entryBar,
          exitBar: i,
          entryPrice: entryPx,
          exitPrice,
          entryTime: entryCandle?.time ?? null,
          exitTime: exitCandle?.time ?? null,
          exitReason,
          pnl,
          profitPercent: profitPercent != null ? Math.round(profitPercent * 100) / 100 : null,
          holdingPeriodDays: barsHeld,
          positionFraction: rem,
          confidenceLabel: setupMeta?.confidenceLabel ?? null,
          confidenceScore:
            setupMeta?.confidenceScore != null && Number.isFinite(Number(setupMeta.confidenceScore))
              ? Number(setupMeta.confidenceScore)
              : null,
          explanation: buildExitExplanation(setupMeta, exitPrice, exitReason, maxHoldingDays),
        });
        position = emptyPosition();
      }

      if (position.entryBar >= 0) continue;
    }

    if (position.entryBar < 0 && entryByBar.has(i)) {
      const sm = setupByEntryBar.get(i);
      position = {
        entryBar: i,
        entryPrice: entryByBar.get(i),
        remainingFraction: 1,
        reboundPrice:
          sm?.reboundPrice != null && Number.isFinite(Number(sm.reboundPrice))
            ? Number(sm.reboundPrice)
            : null,
        partialAtReboundDone: false,
      };
    }
  }

  if (position.entryBar >= 0) {
    const last = ohlcv[ohlcv.length - 1];
    const rem = position.remainingFraction;
    const entryPx = position.entryPrice;
    const entryCandle = ohlcv[position.entryBar];
    const setupMetaEod = setupByEntryBar.get(position.entryBar);
    if (rem > 0) {
      const pnl = rem * (last.close - entryPx);
      equity *= 1 + pnl / entryPx;
      const profitPercent = entryPx !== 0 ? ((last.close - entryPx) / entryPx) * 100 : null;
      trades.push({
        entryBar: position.entryBar,
        exitBar: ohlcv.length - 1,
        entryPrice: entryPx,
        exitPrice: last.close,
        entryTime: entryCandle?.time ?? null,
        exitTime: last?.time ?? null,
        exitReason: 'eod',
        pnl,
        profitPercent: profitPercent != null ? Math.round(profitPercent * 100) / 100 : null,
        holdingPeriodDays: ohlcv.length - 1 - position.entryBar,
        positionFraction: rem,
        confidenceLabel: setupMetaEod?.confidenceLabel ?? null,
        confidenceScore:
          setupMetaEod?.confidenceScore != null && Number.isFinite(Number(setupMetaEod.confidenceScore))
            ? Number(setupMetaEod.confidenceScore)
            : null,
        explanation: buildExitExplanation(setupMetaEod, last.close, 'eod', maxHoldingDays),
      });
    }
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const setupConfidenceSummary = { HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0, total: 0 };
  let setupConfidenceScoreSum = 0;
  let setupConfidenceScoreCount = 0;
  for (const s of setupByEntryBar.values()) {
    const lbl = typeof s?.confidenceLabel === 'string' ? s.confidenceLabel.trim().toUpperCase() : '';
    if (lbl === 'HIGH' || lbl === 'MEDIUM' || lbl === 'LOW') setupConfidenceSummary[lbl] += 1;
    else setupConfidenceSummary.UNKNOWN += 1;
    setupConfidenceSummary.total += 1;
    if (s?.confidenceScore != null && Number.isFinite(Number(s.confidenceScore))) {
      setupConfidenceScoreSum += Number(s.confidenceScore);
      setupConfidenceScoreCount += 1;
    }
  }
  return {
    trades,
    tradesCount: trades.length,
    winRate: trades.length > 0 ? wins / trades.length : 0,
    totalReturn: equity - 1,
    avgConfidenceScore:
      setupConfidenceScoreCount > 0 ? setupConfidenceScoreSum / setupConfidenceScoreCount : null,
    confidenceSummary: setupConfidenceSummary,
    allSetups,
    mode: typeof mode === 'string' ? mode : 'strict',
    thresholds,
    avgR: 0,
    maxHoldingDays,
  };
}

export default { runRsiSetupBacktest };
