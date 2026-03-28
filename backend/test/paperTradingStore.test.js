import test from 'node:test';
import assert from 'node:assert';
import { PaperTradingStore } from '../services/PaperTradingStore.js';

test('PaperTradingStore open and close updates cash and PnL', () => {
  const s = new PaperTradingStore();
  s.initialCapital = 100_000;
  s.reset();

  const o = s.openLong({
    setupId: 'rsi-setup',
    symbol: 'TEST',
    tradingsymbol: 'TEST',
    qty: 10,
    price: 100,
    snapshot: null,
  });
  assert.ok(o.success);
  assert.strictEqual(s.cash, 100_000 - 1000);

  const c = s.closeLong('rsi-setup', 'TEST', 110, 'manual', { signal_type: 'HOLD', explanation: 'exit snap' });
  assert.ok(c.success);
  assert.strictEqual(c.trade.realizedPnl, 100);
  assert.strictEqual(c.trade.investedAmount, 1000);
  assert.strictEqual(c.trade.proceedsAmount, 1100);
  assert.ok(c.trade.exitSnapshot);
  assert.strictEqual(s.cash, 100_000 + 100);
});
