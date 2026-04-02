import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planRsiMaCopyTradeLevels } from '../services/rsiMaSetupCopy.js';

describe('planRsiMaCopyTradeLevels', () => {
  it('returns SL and partial TP matching entry avg (default 3% stop, 10% partial TP)', () => {
    const entry = 100;
    const p = planRsiMaCopyTradeLevels(entry, {});
    assert.equal(p.stopLossPrice, 97);
    assert.equal(p.partialTakeProfitPrice, 110);
    assert.equal(p.stopLossPct, 3);
    assert.equal(p.partialTakeProfitPct, 10);
    assert.equal(p.rsiRemainderExit, 70);
    assert.equal(p.partialTpFraction, 0.8);
  });

  it('respects optional profitTargetPct as percent input (e.g. 15)', () => {
    const p = planRsiMaCopyTradeLevels(200, { profitTargetPct: 15 });
    assert.equal(p.partialTakeProfitPrice, 230);
    assert.equal(p.partialTakeProfitPct, 15);
  });

  it('supports partialTpFraction 100 for full exit at first TP', () => {
    const p = planRsiMaCopyTradeLevels(100, { partialTpFraction: 100 });
    assert.equal(p.partialTpFraction, 1);
  });

  it('returns null for invalid entry', () => {
    assert.equal(planRsiMaCopyTradeLevels(NaN, {}), null);
    assert.equal(planRsiMaCopyTradeLevels(0, {}), null);
  });
});
