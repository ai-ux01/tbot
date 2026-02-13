/**
 * Strategy registry. Each strategy exports: name, create(options) -> { name, onCandle(candle, context), getState() }.
 * onCandle returns null or { signal: 'BUY'|'SELL', state, candle, ... }. getState() returns 'FLAT' | 'LONG'.
 */

export { StrategyState, StrategySignals, StrategyEvents } from './constants.js';

import * as emaCross from './emaCross.js';
import * as breakout from './breakout.js';
import * as rsiReversal from './rsiReversal.js';

/** Lowercase keys so lookup and validation are case-insensitive. */
const modules = {
  emacross: emaCross,
  breakout,
  rsireversal: rsiReversal,
};

/**
 * List of registered strategy names.
 * @returns {string[]}
 */
export function getStrategyNames() {
  return Object.keys(modules);
}

/**
 * Load and create a strategy instance by name. One instance per symbol/context (separate state).
 * @param {string} strategyName - e.g. 'emaCross', 'breakout', 'rsiReversal'
 * @param {Object} [options] - Strategy-specific options
 * @returns {{ name: string, onCandle: Function, getState: Function }}
 */
export function createStrategy(strategyName, options = {}) {
  const key = String(strategyName).toLowerCase();
  const mod = modules[key];
  if (!mod || typeof mod.create !== 'function') {
    throw new Error(`Unknown or invalid strategy: ${strategyName}`);
  }
  return mod.create(options);
}

/**
 * Get strategy module metadata (name) without creating an instance.
 * @param {string} strategyName
 * @returns {{ name: string } | null}
 */
export function getStrategyInfo(strategyName) {
  const key = String(strategyName).toLowerCase();
  const mod = modules[key];
  if (!mod) return null;
  return { name: mod.name ?? key };
}
