/**
 * Swing backtest: DB-only simulation (no broker). Last 12 months, EMA strategy, portfolio risk, ATR sizing.
 * NEW IMPROVEMENTS: Returns winRate, avgR, maxDrawdown, totalReturn, tradesCount.
 */

import { isDbConnected } from '../database/connection.js';
import { HistoricalRepository } from './HistoricalRepository.js';
import { Strategy, StrategySignals } from '../bot/Strategy.js';
import { PositionSizingService } from './PositionSizingService.js';
import { getTradingConfig } from '../config/tradingConfig.js';
import { createExecutionContext } from '../utils/executionLogger.js';

function runStrategy(candles) {
  const strategy = new Strategy();
  const sorted = [...(candles ?? [])].sort((a, b) => (a?.time ?? 0) - (b?.time ?? 0));
  for (const c of sorted) {
    if (c?.close != null && Number.isFinite(c.close)) strategy.addCandle(c);
  }
  return strategy;
}

/** Run EMA on daily; return list of crossover bars with signal (BUY/SELL). */
function getDailyCrossoverSignals(dailyCandles) {
  const strategy = new Strategy();
  const sorted = [...(dailyCandles ?? [])].sort((a, b) => (a?.time ?? 0) - (b?.time ?? 0));
  const signals = [];
  for (const c of sorted) {
    if (c?.close != null && Number.isFinite(c.close)) {
      strategy.addCandle(c);
      const cross = strategy.detectFreshCrossover();
      if (cross) signals.push({ time: c.time, close: c.close, signal: cross });
    }
  }
  return signals;
}

/**
 * Run swing backtest using only DB historical data. No broker calls.
 * @param {{ symbols: Array<{ symbol: string, instrumentToken?: string }>, from?: Date, to?: Date, capital?: number }} opts
 * @returns {Promise<{ winRate: number, avgR: number, maxDrawdown: number, totalReturn: number, tradesCount: number, trades: object[], error?: string }>}
 */
export async function runSwingBacktest(opts = {}) {
  const ctx = createExecutionContext('backtest');
  const config = getTradingConfig();
  const capital = opts.capital ?? config.defaultCapital;
  const to = opts.to ? new Date(opts.to) : new Date();
  const from = opts.from ?? new Date(to.getTime());
  from.setMonth(from.getMonth() - 12);
  if (!opts.from) {
    const f = new Date(to);
    f.setMonth(f.getMonth() - 12);
    from.setTime(f.getTime());
  }

  const result = {
    winRate: 0,
    avgR: 0,
    maxDrawdown: 0,
    totalReturn: 0,
    tradesCount: 0,
    trades: [],
  };

  if (!isDbConnected()) {
    result.error = 'Database not connected; backtest requires historical candles in DB';
    return result;
  }

  const symbols = opts.symbols ?? [];
  if (symbols.length === 0) {
    result.error = 'symbols required (array of { symbol } or { symbol, instrumentToken })';
    return result;
  }

  const allTrades = [];
  let equity = capital;
  let peak = capital;
  let maxDrawdown = 0;
  const openPositions = [];
  const maxOpen = config.maxOpenPositions;
  const maxExposure = capital * config.maxPortfolioExposure;

  for (const { symbol, instrumentToken } of symbols) {
    const key = symbol ?? instrumentToken ?? '';
    if (!key) continue;
    const daily = await HistoricalRepository.getHistoricalFromDb(key, 'day', from, to);
    if (daily.length < 22) continue;

    const monthlyCandles = await HistoricalRepository.getHistoricalFromDb(key, 'month', from, to);
    const weeklyCandles = await HistoricalRepository.getHistoricalFromDb(key, 'week', from, to);
    const monthlyBullish = monthlyCandles.length >= 21 && runStrategy(monthlyCandles).isBullish();
    const weeklyBullish = weeklyCandles.length >= 21 && runStrategy(weeklyCandles).isBullish();

    const signals = getDailyCrossoverSignals(daily);
    for (const s of signals) {
      if (s.signal === StrategySignals.BUY && monthlyBullish && weeklyBullish) {
        if (openPositions.length >= maxOpen) continue;
        const notional = openPositions.reduce((sum, p) => sum + p.entryPrice * p.quantity, 0);
        if (notional >= maxExposure) continue;
        const { quantity } = PositionSizingService.getPositionSize(
          daily.filter((c) => c.time <= s.time),
          s.close,
          capital
        );
        if (quantity <= 0) continue;
        openPositions.push({
          symbol: key,
          entryPrice: s.close,
          quantity,
          entryTime: s.time,
          atrR: 1,
        });
      } else if (s.signal === StrategySignals.SELL) {
        const pos = openPositions.find((p) => p.symbol === key);
        if (!pos) continue;
        const pnl = (s.close - pos.entryPrice) * pos.quantity;
        const riskAmount = (capital * config.riskPerTrade);
        const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;
        equity += pnl;
        if (equity > peak) peak = equity;
        const dd = peak > 0 ? (peak - equity) / peak : 0;
        if (dd > maxDrawdown) maxDrawdown = dd;
        allTrades.push({
          symbol: key,
          entryPrice: pos.entryPrice,
          exitPrice: s.close,
          quantity: pos.quantity,
          pnl,
          rMultiple,
          durationDays: Math.round((s.time - pos.entryTime) / (24 * 60 * 60 * 1000)),
        });
        openPositions.splice(openPositions.indexOf(pos), 1);
      }
    }
  }

  const wins = allTrades.filter((t) => t.pnl > 0).length;
  result.tradesCount = allTrades.length;
  result.winRate = result.tradesCount > 0 ? wins / result.tradesCount : 0;
  const rList = allTrades.map((t) => t.rMultiple).filter((r) => Number.isFinite(r));
  result.avgR = rList.length > 0 ? rList.reduce((a, b) => a + b, 0) / rList.length : 0;
  result.maxDrawdown = maxDrawdown;
  result.totalReturn = capital > 0 ? (equity - capital) / capital : 0;
  result.trades = allTrades;

  ctx.end({
    tradesCount: result.tradesCount,
    winRate: result.winRate,
    totalReturn: result.totalReturn,
    maxDrawdown: result.maxDrawdown,
  });
  return result;
}
