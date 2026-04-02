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

test('PaperTradingStore partialCloseLong keeps avg entry and updates cash', () => {
  const s = new PaperTradingStore();
  s.initialCapital = 100_000;
  s.reset();
  s.openLong({
    setupId: 'rsi-ma-setup-copy',
    symbol: 'T',
    tradingsymbol: 'T',
    qty: 10,
    price: 100,
    snapshot: null,
    paperRules: { kind: 'rsi-ma-setup-copy', partialTpDone: false },
  });
  assert.strictEqual(s.cash, 100_000 - 1000);
  const p = s.partialCloseLong('rsi-ma-setup-copy', 'T', 8, 110);
  assert.ok(p.success);
  const pos = s.getOpen('rsi-ma-setup-copy', 'T');
  assert.strictEqual(pos.qty, 2);
  assert.strictEqual(pos.entryPrice, 100);
  assert.strictEqual(pos.paperRules.partialTpDone, true);
  assert.strictEqual(s.cash, 99_000 + 880);
});

test('PaperTradingStore hydrateFromPersistence restores positions and cash', () => {
  const s = new PaperTradingStore();
  s.initialCapital = 500_000;
  s.reset();
  s.hydrateFromPersistence({
    initialCapital: 1_000_000,
    cash: 750_000,
    positions: [
      {
        id: 'pos-1',
        setupId: 'rsi-setup',
        symbol: 'ABC',
        tradingsymbol: 'ABC',
        qty: 5,
        entryPrice: 200,
        openedAt: '2026-01-01T00:00:00.000Z',
        snapshot: { signal_type: 'BUY' },
        orderValueInr: 1000,
        paperRules: null,
      },
    ],
  });
  assert.strictEqual(s.initialCapital, 1_000_000);
  assert.strictEqual(s.cash, 750_000);
  const open = s.getOpen('rsi-setup', 'ABC');
  assert.ok(open);
  assert.strictEqual(open.qty, 5);
  assert.strictEqual(open.entryPrice, 200);
});
