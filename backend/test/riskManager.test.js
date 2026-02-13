/**
 * Tests for RiskManager: per-strategy position, approveTrade(signal, price, strategyName).
 */
import test from 'node:test';
import assert from 'node:assert';
import { RiskManager, RejectReason } from '../bot/RiskManager.js';

test('RiskManager getPositionSize', () => {
  const rm = new RiskManager({ capital: 100_000, riskPercentPerTrade: 1, stopLossPercent: 2 });
  const size = rm.getPositionSize(100);
  assert(Number.isFinite(size) && size > 0);
  assert.strictEqual(rm.getPositionSize(0), 0);
  assert.strictEqual(rm.getPositionSize(null), 0);
});

test('RiskManager approveTrade BUY/SELL per strategy', () => {
  const rm = new RiskManager({ capital: 100_000, riskPercentPerTrade: 1, stopLossPercent: 2, targetPercent: 3 });
  const price = 100;

  const buyA = rm.approveTrade('BUY', price, 'emaCross');
  assert.strictEqual(buyA.approved, true);
  assert(buyA.quantity > 0);
  assert.strictEqual(rm.getPosition('emaCross')?.quantity, buyA.quantity);

  const buyB = rm.approveTrade('BUY', price, 'breakout');
  assert.strictEqual(buyB.approved, true);
  assert.deepStrictEqual(rm.getPositionStrategyNames().sort(), ['breakout', 'emaCross']);

  const buyAAgain = rm.approveTrade('BUY', price, 'emaCross');
  assert.strictEqual(buyAAgain.approved, false);
  assert.strictEqual(buyAAgain.reason, RejectReason.ALREADY_IN_POSITION);

  const sellB = rm.approveTrade('SELL', price + 1, 'breakout');
  assert.strictEqual(sellB.approved, true);
  assert.strictEqual(rm.getPosition('breakout'), null);
  assert.strictEqual(rm.getPosition('emaCross') != null, true);

  const sellBAgain = rm.approveTrade('SELL', price, 'breakout');
  assert.strictEqual(sellBAgain.approved, false);
  assert.strictEqual(sellBAgain.reason, RejectReason.NO_POSITION);

  const sellA = rm.approveTrade('SELL', price, 'emaCross');
  assert.strictEqual(sellA.approved, true);
  assert.strictEqual(rm.getPosition('emaCross'), null);
});

test('RiskManager clearPosition', () => {
  const rm = new RiskManager({ capital: 100_000, riskPercentPerTrade: 1, stopLossPercent: 2 });
  rm.approveTrade('BUY', 100, 'testStrategy');
  assert(rm.getPosition('testStrategy') != null);
  rm.clearPosition('testStrategy');
  assert.strictEqual(rm.getPosition('testStrategy'), null);
});

test('RiskManager HOLD returns approved', () => {
  const rm = new RiskManager({});
  assert.strictEqual(rm.approveTrade('HOLD', 100, 'x').approved, true);
});

test('RiskManager invalid input', () => {
  const rm = new RiskManager({ capital: 100_000 });
  assert.strictEqual(rm.approveTrade('INVALID', 100, 'x').approved, false);
  assert.strictEqual(rm.approveTrade('BUY', -1, 'x').approved, false);
});
