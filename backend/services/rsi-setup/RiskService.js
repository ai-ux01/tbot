/**
 * RiskService: ATR-based stop loss, target, 2:1 risk-reward filter.
 * All parameters from config - no hardcoding.
 */

import { RSI_SETUP_CONFIG } from './config.js';

/**
 * Calculate stop loss: Entry - (atrMultiplier × ATR)
 * @param {number} entryPrice
 * @param {number} atr
 * @returns {{ stopLoss: number, risk: number }}
 */
export function calculateStopLoss(entryPrice, atr) {
  const { atrMultiplier } = RSI_SETUP_CONFIG;
  if (entryPrice == null || !Number.isFinite(entryPrice) || atr == null || !Number.isFinite(atr) || atr <= 0) {
    return { stopLoss: null, risk: null };
  }
  const stopLoss = entryPrice - atrMultiplier * atr;
  const risk = entryPrice - stopLoss;
  return { stopLoss, risk };
}

/**
 * Calculate target: Entry + (Risk × minRiskReward)
 * @param {number} entryPrice
 * @param {number} stopLoss
 * @returns {number|null} target price
 */
export function calculateTarget(entryPrice, stopLoss) {
  const { minRiskReward } = RSI_SETUP_CONFIG;
  if (entryPrice == null || stopLoss == null || !Number.isFinite(entryPrice) || !Number.isFinite(stopLoss)) {
    return null;
  }
  const risk = entryPrice - stopLoss;
  if (risk <= 0) return null;
  return entryPrice + risk * minRiskReward;
}

/**
 * Check if recent swing high allows minimum risk-reward.
 * Reject (return false) if target > swingHigh (no room for 2R).
 * @param {number} entryPrice
 * @param {number} stopLoss
 * @param {number} recentSwingHigh - max high from relevant bars
 * @returns {{ allowed: boolean, target: number|null, riskRewardRatio: number }}
 */
export function checkRiskRewardFilter(entryPrice, stopLoss, recentSwingHigh) {
  const target = calculateTarget(entryPrice, stopLoss);
  if (target == null) {
    return { allowed: false, target: null, riskRewardRatio: 0 };
  }
  const risk = entryPrice - stopLoss;
  const riskRewardRatio = risk > 0 ? (target - entryPrice) / risk : 0;
  const allowed = recentSwingHigh != null && Number.isFinite(recentSwingHigh) && recentSwingHigh >= target;
  return { allowed, target, riskRewardRatio };
}

/**
 * Get recent swing high from close/high arrays (from peak2 bar to last).
 * @param {number[]} high - price highs
 * @param {number} fromIndex - start index (e.g. absPeak2)
 * @returns {number|null}
 */
export function getRecentSwingHigh(high, fromIndex) {
  if (!Array.isArray(high) || fromIndex < 0 || fromIndex >= high.length) return null;
  const slice = high.slice(fromIndex);
  const valid = slice.filter((v) => v != null && Number.isFinite(v));
  return valid.length > 0 ? Math.max(...valid) : null;
}

export default {
  calculateStopLoss,
  calculateTarget,
  checkRiskRewardFilter,
  getRecentSwingHigh,
};
