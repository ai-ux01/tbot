/**
 * BacktestingEngine – runs strategy (from strategies/) + RiskManager over historical candles.
 * Simulates entry, stop loss, target, and signal-based exit. Risk tracked per strategy.
 */

import { createStrategy } from '../strategies/index.js';
import { RiskManager } from './RiskManager.js';

const DEFAULT_RISK = {
  capital: 100_000,
  riskPercentPerTrade: 1,
  stopLossPercent: 2,
  targetPercent: 3,
  maxDailyLossPercent: 100,
};

/**
 * Run a backtest for a single strategy over historical candles.
 * @param {Object} options
 * @param {string} options.strategyName - e.g. 'emaCross', 'breakout', 'rsiReversal'
 * @param {string} options.symbol
 * @param {string} options.timeframe
 * @param {Array<{ time: number, open: number, high: number, low: number, close: number }>} options.candles - sorted by time ascending
 * @param {Object} [options.risk] - RiskManager options
 * @param {Object} [options.strategyOptions] - Strategy-specific options
 * @param {boolean} [options.includeTrades=true] - Include trades array with entry/exit details
 * @param {boolean} [options.exitOnCandleClose=false] - If true, SL/target only checked at candle close (no intrabar)
 * @returns {Promise<{ strategyName, symbol, timeframe, totalTrades, wins, losses, winRate, totalPnL, maxDrawdown, equityCurve, sharpeRatio, trades? }>}
 */
export function runBacktest(options = {}) {
  const { strategyName, symbol, timeframe, candles: rawCandles, risk: riskOptions = {}, strategyOptions = {}, includeTrades = true, exitOnCandleClose = false } = options;
  if (!strategyName || !symbol || !timeframe) {
    throw new Error('BacktestingEngine: strategyName, symbol, timeframe required');
  }
  let candles = Array.isArray(rawCandles) ? rawCandles : [];
  if (candles.length === 0) {
    return Promise.resolve({
      strategyName,
      symbol,
      timeframe,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnL: 0,
      maxDrawdown: 0,
      equityCurve: [],
      sharpeRatio: null,
      trades: [],
    });
  }

  candles = [...candles].sort((a, b) => (a?.time ?? 0) - (b?.time ?? 0));
  const risk = { ...DEFAULT_RISK, ...riskOptions };
  const strategy = createStrategy(strategyName, strategyOptions);
  const riskManager = new RiskManager(risk);
  const context = { symbol };

  const capital = Number(risk.capital) || 100_000;
  let equity = capital;
  let peakEquity = capital;
  let maxDrawdown = 0;
  const equityCurve = [];
  /** @type {{ quantity: number, entryPrice: number, stopLoss: number, target: number, entryTime: number } | null} */
  let positionRef = null;
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;
  let totalPnL = 0;
  const tradePnLs = [];
  const trades = [];

  function toMs(t) {
    if (t == null) return null;
    if (t instanceof Date) return t.getTime();
    if (typeof t === 'number') return t < 1e10 ? t * 1000 : t;
    if (typeof t === 'string') return new Date(t).getTime();
    return null;
  }

  function closePosition(exitPrice, pnl, exitTime, exitReason) {
    if (!positionRef) return;
    if (includeTrades) {
      const entryTime = positionRef.entryTime;
      const exitT = exitTime ?? entryTime;
      const entryMs = toMs(entryTime);
      const exitMs = toMs(exitT);
      const holdingTimeDays = entryMs != null && exitMs != null && exitMs >= entryMs ? (exitMs - entryMs) / (24 * 60 * 60 * 1000) : null;
      const entryValue = positionRef.entryPrice * positionRef.quantity;
      const profitPercent = entryValue !== 0 && Number.isFinite(pnl) ? (pnl / entryValue) * 100 : null;
      trades.push({
        entryTime: positionRef.entryTime,
        entryPrice: positionRef.entryPrice,
        exitTime: exitT,
        exitPrice: exitPrice,
        quantity: positionRef.quantity,
        pnl,
        exitReason: exitReason || 'SIGNAL',
        holdingTimeDays: holdingTimeDays != null ? Math.round(holdingTimeDays * 100) / 100 : null,
        profitPercent: profitPercent != null ? Math.round(profitPercent * 100) / 100 : null,
      });
    }
    totalTrades += 1;
    totalPnL += pnl;
    tradePnLs.push(pnl);
    if (pnl > 0) wins += 1;
    else if (pnl < 0) losses += 1;
    equity += pnl;
    if (equity > peakEquity) peakEquity = equity;
    const drawdown = peakEquity - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    positionRef = null;
    riskManager.clearPosition(strategyName);
  }

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const o = candle?.open;
    const h = candle?.high;
    const l = candle?.low;
    const c = candle?.close;
    const candleTime = candle?.time ?? i;
    if (o == null || h == null || l == null || c == null || !Number.isFinite(c)) continue;

    equityCurve.push({ time: candleTime, equity });

    if (positionRef) {
      const pos = positionRef;
      const hitSl = exitOnCandleClose ? c <= pos.stopLoss : l <= pos.stopLoss;
      const hitTarget = exitOnCandleClose ? c >= pos.target : h >= pos.target;
      if (hitSl && hitTarget) {
        const pnl = (pos.stopLoss - pos.entryPrice) * pos.quantity;
        closePosition(exitOnCandleClose ? c : pos.stopLoss, pnl, candleTime, 'SL');
      } else if (hitSl) {
        const pnl = (pos.stopLoss - pos.entryPrice) * pos.quantity;
        closePosition(exitOnCandleClose ? c : pos.stopLoss, pnl, candleTime, 'SL');
      } else if (hitTarget) {
        const pnl = (pos.target - pos.entryPrice) * pos.quantity;
        closePosition(exitOnCandleClose ? c : pos.target, pnl, candleTime, 'TARGET');
      }
    }

    const result = strategy.onCandle(candle, context);
    if (result != null && (result.signal === 'BUY' || result.signal === 'SELL')) {
      const price = result.candle?.close;
      if (price == null || !Number.isFinite(price)) continue;

      if (result.signal === 'BUY' && !positionRef) {
        const res = riskManager.approveTrade('BUY', price, strategyName);
        if (res.approved && res.quantity > 0) {
          positionRef = {
            quantity: res.quantity,
            entryPrice: price,
            stopLoss: res.stopLoss,
            target: res.target,
            entryTime: candleTime,
          };
        }
      } else if (result.signal === 'SELL' && positionRef) {
        const res = riskManager.approveTrade('SELL', price, strategyName);
        if (res.approved && res.quantity != null) {
          const pnl = res.realizedPnl ?? (price - positionRef.entryPrice) * positionRef.quantity;
          closePosition(price, pnl, candleTime, 'SIGNAL');
        }
      }
    }
  }

  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  let sharpeRatio = null;
  if (tradePnLs.length >= 2) {
    const mean = tradePnLs.reduce((a, b) => a + b, 0) / tradePnLs.length;
    const variance = tradePnLs.reduce((s, p) => s + (p - mean) ** 2, 0) / (tradePnLs.length - 1);
    const std = Math.sqrt(variance);
    if (std > 1e-10) {
      sharpeRatio = (mean / std) * Math.sqrt(tradePnLs.length);
    }
  }

  const out = {
    strategyName,
    symbol,
    timeframe,
    totalTrades,
    wins,
    losses,
    winRate,
    totalPnL,
    maxDrawdown,
    equityCurve,
    sharpeRatio,
  };
  if (includeTrades) out.trades = trades;
  return Promise.resolve(out);
}
