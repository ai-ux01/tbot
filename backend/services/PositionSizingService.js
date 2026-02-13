/**
 * Portfolio Layer: ATR-based position sizing.
 * NEW IMPROVEMENTS: positionSize = riskAmount / ATR(14); quantity rounded for lot size.
 */

import { getTradingConfig } from '../config/tradingConfig.js';
import { DataIntegrityService } from './DataIntegrityService.js';

/**
 * Compute ATR(period) from daily candles (high, low, close).
 * @param {Array<{ high: number, low: number, close: number }>} candles - Sorted by time ascending
 * @param {number} period
 * @returns {number|null}
 */
function atr(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const trList = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const high = curr.high ?? curr.close;
    const low = curr.low ?? curr.close;
    const prevClose = prev.close ?? prev.open;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trList.push(tr);
  }
  if (trList.length < period) return null;
  const recent = trList.slice(-period);
  const sum = recent.reduce((a, b) => a + b, 0);
  return sum / period;
}

/**
 * PositionSizingService – ATR-based quantity.
 * riskPerTrade = config (e.g. 1% of capital); positionSize = riskAmount / ATR.
 */
export class PositionSizingService {
  /**
   * Get position size (quantity) from daily candles and capital.
   * @param {Array<{ time: number, open: number, high: number, low: number, close: number }>} dailyCandles - Sorted ascending
   * @param {number} entryPrice - Reference/entry price
   * @param {number} [capital] - Total capital; defaults to config defaultCapital
   * @param {{ riskPerTrade?: number, atrPeriod?: number }} [opts]
   * @returns {{ quantity: number, atrValue: number|null, riskAmount: number }}
   */
  static getPositionSize(dailyCandles, entryPrice, capital, opts = {}) {
    const config = getTradingConfig();
    const riskPerTrade = opts.riskPerTrade ?? config.riskPerTrade;
    const atrPeriod = opts.atrPeriod ?? config.atrPeriod;
    const cap = Number(capital) || config.defaultCapital;

    const validated = DataIntegrityService.validateCandles(dailyCandles, 'PositionSizing');
    const atrValue = atr(validated, atrPeriod);

    const riskAmount = cap * riskPerTrade;
    if (entryPrice == null || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      return { quantity: 0, atrValue: atrValue ?? null, riskAmount };
    }
    if (atrValue == null || atrValue <= 0) {
      return { quantity: 0, atrValue: null, riskAmount };
    }
    const rawQty = riskAmount / atrValue;
    const quantity = Math.floor(rawQty);
    return { quantity: Math.max(0, quantity), atrValue, riskAmount };
  }
}

export default PositionSizingService;
