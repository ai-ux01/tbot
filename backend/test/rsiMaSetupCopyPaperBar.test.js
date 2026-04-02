import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveRsiMaCopyPaperIntrabarActions } from '../services/rsiMaSetupCopy.js';

describe('resolveRsiMaCopyPaperIntrabarActions', () => {
  it('returns empty when barsHeld < 1', () => {
    const { actions } = resolveRsiMaCopyPaperIntrabarActions(
      { qty: 10, totalCost: 1000, partialTpDone: false },
      { high: 200, low: 90, close: 100 },
      50,
      0,
      {},
    );
    assert.deepEqual(actions, []);
  });

  it('closes at stop when low breaches SL after entry (3% below avg)', () => {
    const { actions } = resolveRsiMaCopyPaperIntrabarActions(
      { qty: 10, totalCost: 1000, partialTpDone: false },
      { high: 101, low: 96.5, close: 100 },
      30,
      1,
      {},
    );
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'close');
    assert.equal(actions[0].price, 97);
  });

  it('partial then stop same bar when TP hit then remainder hits SL', () => {
    const { actions } = resolveRsiMaCopyPaperIntrabarActions(
      { qty: 10, totalCost: 1000, partialTpDone: false },
      { high: 120, low: 96.5, close: 100 },
      25,
      1,
      {},
    );
    assert.equal(actions.length, 2);
    assert.equal(actions[0].type, 'partial');
    assert.equal(actions[0].sellQty, 8);
    assert.ok(Math.abs(actions[0].price - 110) < 1e-6);
    assert.equal(actions[1].type, 'close');
    assert.equal(actions[1].price, 97);
  });

  it('100% partial fraction closes full position at TP in one action', () => {
    const { actions } = resolveRsiMaCopyPaperIntrabarActions(
      { qty: 10, totalCost: 1000, partialTpDone: false },
      { high: 120, low: 100, close: 100 },
      25,
      1,
      { partialTpFraction: 100 },
    );
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'close');
    assert.ok(Math.abs(actions[0].price - 110) < 1e-6);
    assert.equal(actions[0].reason, 'profit_target_full');
  });

  it('after partial, exits remainder on RSI >= threshold at close', () => {
    const { actions } = resolveRsiMaCopyPaperIntrabarActions(
      { qty: 2, totalCost: 200, partialTpDone: true },
      { high: 108, low: 100, close: 105 },
      72,
      2,
      { rsiRemainderExit: 70 },
    );
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, 'close');
    assert.equal(actions[0].price, 105);
  });
});
