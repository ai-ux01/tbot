/**
 * RSI Setup backtest options (max holding).
 */
import test from 'node:test';
import assert from 'node:assert';
import { runRsiSetupBacktest } from '../services/rsi-setup/backtest.js';

function flatOhlcv(n) {
  return Array.from({ length: n }, (_, i) => ({
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
    time: i,
  }));
}

test('runRsiSetupBacktest echoes maxHoldingDays null when not set', () => {
  const r = runRsiSetupBacktest(flatOhlcv(60));
  assert.strictEqual(r.maxHoldingDays, null);
});

test('runRsiSetupBacktest echoes maxHoldingDays when set', () => {
  const r = runRsiSetupBacktest(flatOhlcv(60), { maxHoldingDays: 12 });
  assert.strictEqual(r.maxHoldingDays, 12);
});

test('runRsiSetupBacktest ignores invalid maxHoldingDays', () => {
  const r = runRsiSetupBacktest(flatOhlcv(60), { maxHoldingDays: 0 });
  assert.strictEqual(r.maxHoldingDays, null);
});

test('runRsiSetupBacktest returns allSetups array (every pattern, not only traded)', () => {
  const r = runRsiSetupBacktest(flatOhlcv(60));
  assert.ok(Array.isArray(r.allSetups));
});
