/**
 * RSI Momentum Reset in Uptrend (1D Only)
 * Uses RSIMomentumResetStrategy for strict state-machine evaluation.
 */

import { RSI_SETUP_CONFIG } from './config.js';
import { RSIMomentumResetStrategy } from './RSIMomentumResetStrategy.js';

export const RSI_SETUP_MODES = {
  STRICT: 'strict',
  LENIENT: 'lenient',
};

export function normalizeRsiSetupMode(rawMode) {
  const mode = String(rawMode || '').trim().toLowerCase();
  return mode === RSI_SETUP_MODES.LENIENT ? RSI_SETUP_MODES.LENIENT : RSI_SETUP_MODES.STRICT;
}

function getModeOverrides(mode) {
  if (mode === RSI_SETUP_MODES.LENIENT) {
    return {
      rsiPeakThreshold: 65,
      low1Min: 33,
      low1Max: 48,
      reboundMin: 50,
      reboundMax: 68,
      maTouchTolerance: 4,
      maTouchAboveSlack: 5,
      tolerancePercent: 1.2,
    };
  }
  return {
    rsiPeakThreshold: RSI_SETUP_CONFIG.rsiPeakThreshold ?? 70,
    low1Min: RSI_SETUP_CONFIG.pullbackLowMin ?? 35,
    low1Max: RSI_SETUP_CONFIG.pullbackLowMax ?? 45,
    reboundMin: RSI_SETUP_CONFIG.reboundMin ?? 55,
    reboundMax: RSI_SETUP_CONFIG.reboundMax ?? 65,
    maTouchTolerance: RSI_SETUP_CONFIG.maTouchTolerance ?? 2.5,
    maTouchAboveSlack: RSI_SETUP_CONFIG.maTouchAboveSlack ?? 3.5,
    tolerancePercent: RSI_SETUP_CONFIG.priceTolerancePct ?? 0.5,
  };
}

function toFiniteOrUndefined(v) {
  return Number.isFinite(Number(v)) ? Number(v) : undefined;
}

function normalizeThresholdOverrides(raw) {
  const low1Min = toFiniteOrUndefined(raw?.low1Min);
  const low1Max = toFiniteOrUndefined(raw?.low1Max);
  const reboundMin = toFiniteOrUndefined(raw?.reboundMin);
  const reboundMax = toFiniteOrUndefined(raw?.reboundMax);
  const maTouchTolerance = toFiniteOrUndefined(raw?.maTouchTolerance);
  const maTouchAboveSlack = toFiniteOrUndefined(raw?.maTouchAboveSlack);
  return {
    ...(low1Min != null ? { low1Min } : {}),
    ...(low1Max != null ? { low1Max } : {}),
    ...(reboundMin != null ? { reboundMin } : {}),
    ...(reboundMax != null ? { reboundMax } : {}),
    ...(maTouchTolerance != null ? { maTouchTolerance } : {}),
    ...(maTouchAboveSlack != null ? { maTouchAboveSlack } : {}),
  };
}

/**
 * Build aligned { close, low } series for the strategy (same rows as legacy close-only filter).
 * @param {Array<{ close?: number, low?: number }>} ohlcv
 * @returns {Array<{ close: number, low: number }>}
 */
export function buildStrategyCandles(ohlcv) {
  if (!Array.isArray(ohlcv)) return [];
  return ohlcv
    .map((c) => {
      if (!c || typeof c.close !== 'number' || !Number.isFinite(c.close)) return null;
      const low =
        typeof c.low === 'number' && Number.isFinite(c.low) ? c.low : c.close;
      const high =
        typeof c.high === 'number' && Number.isFinite(c.high) ? c.high : c.close;
      return { close: c.close, low, high };
    })
    .filter(Boolean);
}

/**
 * @param {{
 *   peakPrice?: number|null, low1Price?: number|null, preReboundLowPrice?: number|null,
 *   reboundPrice?: number|null, entryPrice?: number|null,
 *   exitPrice?: number|null,
 *   exitReason?: 'setup_complete'|'eod'|'max_holding'|'rebound_partial_70'|'stop_pullback_low'|null,
 *   maxHoldingDays?: number|null,
 *   stopLossFromPullbackLowPct?: number|null
 * }} r
 */
export function formatRsiMomentumResetExplanation(r) {
  const p = (x) => (x != null && Number.isFinite(Number(x)) ? Number(x).toFixed(2) : '—');
  const hasExit = r.exitPrice != null && Number.isFinite(Number(r.exitPrice));
  let exitSentence;
  if (hasExit && r.exitReason === 'eod') {
    exitSentence = `End of series; exit @ ${p(r.exitPrice)} (last bar close).`;
  } else if (hasExit && r.exitReason === 'max_holding') {
    const d = r.maxHoldingDays != null ? String(r.maxHoldingDays) : 'max';
    exitSentence = `Max holding (${d} bar${d === '1' ? '' : 's'}) reached; exit @ ${p(r.exitPrice)} (close of that bar).`;
  } else if (hasExit && r.exitReason === 'stop_pullback_low') {
    const pct =
      r.stopLossFromPullbackLowPct != null && Number.isFinite(Number(r.stopLossFromPullbackLowPct))
        ? Math.round(Number(r.stopLossFromPullbackLowPct) * 10000) / 100
        : 3;
    exitSentence = `Stop loss ${pct}% below lowest before rebound (${p(r.preReboundLowPrice)}); exit @ ${p(r.exitPrice)} when low ≤ stop.`;
  } else if (hasExit && r.exitReason === 'rebound_partial_70') {
    exitSentence = `Backtest: scale out 70% @ rebound day high @ ${p(r.exitPrice)} when high ≥ target.`;
  } else if (hasExit && r.exitReason === 'setup_complete') {
    exitSentence = `Exit when RSI touches 70 again (setup complete) @ ${p(r.exitPrice)} (close of that bar).`;
  } else if (hasExit) {
    exitSentence = `Exit @ ${p(r.exitPrice)} (close of that bar).`;
  } else {
    exitSentence =
      'Exit when RSI touches 70 again (setup complete); exit price is the close of the bar where RSI ≥ 70.';
  }
  const parts = [
    'RSI momentum reset:',
    `Peak ≥70 @ ${p(r.peakPrice)} →`,
    `Low1 (below 45) @ ${p(r.low1Price)} →`,
  ];
  if (r.preReboundLowPrice != null && Number.isFinite(Number(r.preReboundLowPrice))) {
    parts.push(
      `Lowest price before rebound (above 55) @ ${p(r.preReboundLowPrice)} (pullback low after peak) →`
    );
  }
  parts.push(
    `Rebound @ ${p(r.reboundPrice)} (day high) →`,
    `RSI near/crosses RSI SMA while RSI SMA is rising @ ${p(r.entryPrice)}.`,
    `Entry when close ≈ low1_price (${p(r.low1Price)}), 0.5% tol; RSI MA > prior bar MA.`,
    exitSentence
  );
  return parts.join(' ');
}

/**
 * Evaluate RSI Momentum Reset. Returns signal for the last (current) bar.
 * @param {Array<{ open, high, low, close, volume? }>} ohlcv - Candles oldest first
 * @returns {{ signal: 'BUY'|'HOLD', entryPrice?, confidenceLabel?, confidenceScore?, structure?, explanation? }}
 */
export function evaluate(ohlcv, _marketContext = {}, options = {}) {
  const emptyResult = {
    signal: 'HOLD',
    explanation: 'Insufficient data or structure not found.',
  };

  if (!Array.isArray(ohlcv) || ohlcv.length < 50) return emptyResult;

  const strategyCandles = buildStrategyCandles(ohlcv);
  if (strategyCandles.length < 50) return emptyResult;

  const mode = normalizeRsiSetupMode(options?.mode);
  const modeOverrides = { ...getModeOverrides(mode), ...normalizeThresholdOverrides(options?.thresholds) };
  const strategy = new RSIMomentumResetStrategy({
    rsiLength: RSI_SETUP_CONFIG.rsiLength ?? 14,
    rsiMaLength: RSI_SETUP_CONFIG.rsiLength ?? 14,
    lookbackDays: Number(process.env.RSI_LOOKBACK_DAYS) || 30,
    ...modeOverrides,
  });

  const results = strategy.evaluate(strategyCandles);
  const last = results[results.length - 1];

  if (!last || !last.signal) return emptyResult;

  const explanation = formatRsiMomentumResetExplanation(last);

  return {
    signal: 'BUY',
    entryPrice: last.entryPrice,
    confidenceLabel: last.confidenceLabel ?? null,
    confidenceScore:
      Number.isFinite(Number(last.confidenceScore)) ? Number(last.confidenceScore) : 65,
    structure: {
      low1Index: null,
      entryIndex: last.entryIndex,
    },
    explanation,
    reason: 'RSI momentum reset',
    mode,
  };
}

/**
 * Return all BUY setups in the lookback window (one per completed pattern).
 * @param {Array<{ open, high, low, close, volume? }>} ohlcv - Candles oldest first
 * @returns {{ setups: Array<{ entryPrice: number, entryIndex: number }>, lastResult: object | null }}
 */
export function evaluateAllSetups(ohlcv, options = {}) {
  const out = { setups: [], lastResult: null };
  if (!Array.isArray(ohlcv) || ohlcv.length < 50) return out;

  const strategyCandles = buildStrategyCandles(ohlcv);
  if (strategyCandles.length < 50) return out;

  const mode = normalizeRsiSetupMode(options?.mode);
  const modeOverrides = { ...getModeOverrides(mode), ...normalizeThresholdOverrides(options?.thresholds) };
  const strategy = new RSIMomentumResetStrategy({
    rsiLength: RSI_SETUP_CONFIG.rsiLength ?? 14,
    rsiMaLength: RSI_SETUP_CONFIG.rsiLength ?? 14,
    lookbackDays: Number(process.env.RSI_LOOKBACK_DAYS) || 30,
    ...modeOverrides,
  });

  const results = strategy.evaluate(strategyCandles);
  const last = results[results.length - 1] || null;

  out.setups = results
    .filter((r) => r && r.signal === true && r.entryPrice != null && r.entryIndex != null)
    .map((r) => ({
      entryPrice: r.entryPrice,
      entryIndex: r.entryIndex,
      peakPrice: r.peakPrice,
      peakIndex: r.peakIndex,
      low1Price: r.low1Price,
      low1Index: r.low1Index,
      preReboundLowPrice: r.preReboundLowPrice,
      preReboundLowIndex: r.preReboundLowIndex,
      reboundPrice: r.reboundPrice,
      reboundIndex: r.reboundIndex,
      confidenceLabel: r.confidenceLabel ?? null,
      confidenceScore:
        Number.isFinite(Number(r.confidenceScore)) ? Number(r.confidenceScore) : 65,
      mode,
      explanation: formatRsiMomentumResetExplanation(r),
    }));

  if (last && last.signal) {
    out.lastResult = {
      signal: 'BUY',
      entryPrice: last.entryPrice,
      entryIndex: last.entryIndex,
      confidenceLabel: last.confidenceLabel ?? null,
      confidenceScore:
        Number.isFinite(Number(last.confidenceScore)) ? Number(last.confidenceScore) : 65,
      mode,
      explanation: formatRsiMomentumResetExplanation(last),
    };
  }

  return out;
}

export default { evaluate, evaluateAllSetups, buildStrategyCandles, formatRsiMomentumResetExplanation };
