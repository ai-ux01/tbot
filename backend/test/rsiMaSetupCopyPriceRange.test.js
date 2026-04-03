import assert from 'node:assert';
import { describe, it } from 'node:test';
import { evaluateAllSetups, resolveRsiMaCopyEvalOpts, MIN_STOCK_PRICE } from '../services/rsiMaSetupCopy.js';

/** Build minimal rising OHLCV so RSI pattern can complete (simplified smoke). */
function syntheticOhlcv(n = 80) {
  const ohlcv = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    px += i % 7 === 0 ? -2 : 0.4;
    const c = Math.max(15, px);
    ohlcv.push({ open: c - 0.5, high: c + 1, low: c - 1, close: c, volume: 1e6 });
  }
  return ohlcv;
}

describe('RSI↓MA Setup (copy) price range', () => {
  it('resolveRsiMaCopyEvalOpts applies max and drops max when max < min', () => {
    const a = resolveRsiMaCopyEvalOpts({ minStockPrice: 50, maxStockPrice: 500 });
    assert.equal(a.minStockPrice, 50);
    assert.equal(a.maxStockPrice, 500);
    const b = resolveRsiMaCopyEvalOpts({ minStockPrice: 200, maxStockPrice: 100 });
    assert.equal(b.minStockPrice, 200);
    assert.equal(b.maxStockPrice, null);
  });

  it('default min is MIN_STOCK_PRICE when options empty', () => {
    const r = resolveRsiMaCopyEvalOpts({});
    assert.equal(r.minStockPrice, MIN_STOCK_PRICE);
    assert.equal(r.maxStockPrice, null);
  });

  it('evaluateAllSetups accepts evalOpts without throwing', () => {
    const ohlcv = syntheticOhlcv(90);
    assert.ok(ohlcv.length >= 30);
    const { setups: s0 } = evaluateAllSetups(ohlcv, {});
    const { setups: s1 } = evaluateAllSetups(ohlcv, { minStockPrice: 1, maxStockPrice: 1e9 });
    assert.ok(Array.isArray(s0));
    assert.ok(Array.isArray(s1));
    assert.ok(s1.length <= s0.length);
  });
});
