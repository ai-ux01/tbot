/**
 * Tests for BacktestingEngine: runBacktest with mock candles.
 */
import test from 'node:test';
import assert from 'node:assert';
import { runBacktest } from '../bot/BacktestingEngine.js';

function makeCandles(n, basePrice = 100, trend = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = basePrice + trend * i + (Math.random() - 0.5) * 2;
    const o = out.length ? out[out.length - 1].close : c;
    out.push({ time: i, open: o, high: Math.max(o, c) + 0.5, low: Math.min(o, c) - 0.5, close: c });
  }
  return out;
}

test('runBacktest returns result shape', async () => {
  const candles = makeCandles(50, 100);
  const result = await runBacktest({
    strategyName: 'emaCross',
    symbol: 'TEST',
    timeframe: '1m',
    candles,
  });
  assert.strictEqual(result.strategyName, 'emaCross');
  assert.strictEqual(result.symbol, 'TEST');
  assert.strictEqual(result.timeframe, '1m');
  assert(Number.isFinite(result.totalTrades));
  assert(Number.isFinite(result.winRate));
  assert(Number.isFinite(result.totalPnL));
  assert(Number.isFinite(result.maxDrawdown));
  assert(Array.isArray(result.equityCurve));
  assert(result.sharpeRatio === null || Number.isFinite(result.sharpeRatio));
});

test('runBacktest empty candles returns zeros', async () => {
  const result = await runBacktest({
    strategyName: 'emaCross',
    symbol: 'TEST',
    timeframe: '1m',
    candles: [],
  });
  assert.strictEqual(result.totalTrades, 0);
  assert.strictEqual(result.totalPnL, 0);
  assert.strictEqual(result.winRate, 0);
});

test('runBacktest throws without strategyName or symbol', () => {
  assert.throws(
    () => runBacktest({ symbol: 'X', timeframe: '1m', candles: makeCandles(10) }),
    /strategyName|required/
  );
  assert.throws(
    () => runBacktest({ strategyName: 'emaCross', timeframe: '1m', candles: makeCandles(10) }),
    /symbol|required/
  );
});

test('runBacktest works with breakout strategy', async () => {
  const candles = makeCandles(60, 100);
  const result = await runBacktest({
    strategyName: 'breakout',
    symbol: 'TEST',
    timeframe: '1m',
    candles,
    strategyOptions: { lookback: 10 },
  });
  assert.strictEqual(result.strategyName, 'breakout');
  assert(Number.isFinite(result.totalPnL));
});
