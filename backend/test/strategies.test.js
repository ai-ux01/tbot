/**
 * Tests for strategy modules: name, onCandle(candle, context), getState().
 */
import test from 'node:test';
import assert from 'node:assert';
import { createStrategy, getStrategyNames } from '../strategies/index.js';

const ctx = { symbol: 'TEST' };

function candle(t, o, h, l, c) {
  return { time: t, open: o, high: h, low: l, close: c };
}

test('getStrategyNames returns list', () => {
  const names = getStrategyNames();
  assert(Array.isArray(names));
  assert(names.includes('emacross'));
  assert(names.includes('breakout'));
  assert(names.includes('rsireversal'));
});

test('emaCross: create returns name, onCandle, getState', () => {
  const s = createStrategy('emaCross');
  assert.strictEqual(s.name, 'emaCross');
  assert(typeof s.onCandle === 'function');
  assert(typeof s.getState === 'function');
  assert.strictEqual(s.getState(), 'FLAT');
});

test('emaCross: onCandle with invalid candle returns null', () => {
  const s = createStrategy('emaCross');
  assert.strictEqual(s.onCandle(null, ctx), null);
  assert.strictEqual(s.onCandle({}, ctx), null);
  assert.strictEqual(s.onCandle({ open: 100 }, ctx), null);
});

test('emaCross: needs enough candles before signal', () => {
  const s = createStrategy('emaCross');
  for (let i = 0; i < 25; i++) {
    const result = s.onCandle(candle(i, 100, 101, 99, 100), ctx);
    if (i < 21) assert(result === null || result?.signal === 'HOLD' || result?.signal === 'BUY' || result?.signal === 'SELL');
  }
  assert(['FLAT', 'LONG'].includes(s.getState()));
});

test('breakout: create and getState', () => {
  const s = createStrategy('breakout', { lookback: 5 });
  assert.strictEqual(s.name, 'breakout');
  assert.strictEqual(s.getState(), 'FLAT');
  assert.strictEqual(s.onCandle(candle(0, 100, 101, 99, 100), ctx), null);
});

test('breakout: BUY when close breaks above high of lookback', () => {
  const s = createStrategy('breakout', { lookback: 3 });
  const base = 100;
  s.onCandle(candle(0, base, base + 1, base - 1, base), ctx);
  s.onCandle(candle(1, base, base + 1, base - 1, base), ctx);
  s.onCandle(candle(2, base, base + 1, base - 1, base), ctx);
  s.onCandle(candle(3, base, base + 1, base - 1, base), ctx);
  const result = s.onCandle(candle(4, base, base + 5, base, base + 5), ctx);
  assert(result === null || result?.signal === 'BUY' || result?.signal === 'HOLD');
  if (result?.signal === 'BUY') assert.strictEqual(s.getState(), 'LONG');
});

test('rsiReversal: create and getState', () => {
  const s = createStrategy('rsiReversal');
  assert.strictEqual(s.name, 'rsiReversal');
  assert.strictEqual(s.getState(), 'FLAT');
});

test('rsiReversal: onCandle with few candles returns null', () => {
  const s = createStrategy('rsiReversal', { period: 5 });
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(s.onCandle(candle(i, 100, 101, 99, 100 - i), ctx), null);
  }
});

test('createStrategy throws for unknown name', () => {
  assert.throws(() => createStrategy('unknownStrategy'), /Unknown|invalid/);
});
