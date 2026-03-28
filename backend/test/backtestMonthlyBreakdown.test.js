import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateTradesByExitMonth } from '../services/backtestMonthlyBreakdown.js';

test('aggregateTradesByExitMonth groups by UTC month and compounds sequentially', () => {
  const trades = [
    {
      exitTime: '2024-01-15T00:00:00.000Z',
      pnl: 50,
      investedAmount: 1000,
      profitPercent: 5,
    },
    {
      exitTime: '2024-01-20T00:00:00.000Z',
      pnl: -20,
      investedAmount: 1000,
      profitPercent: -2,
    },
    {
      exitTime: '2024-02-10T00:00:00.000Z',
      pnl: 100,
      investedAmount: 1000,
      profitPercent: 10,
    },
  ];
  const rows = aggregateTradesByExitMonth(trades, null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].month, '2024-01');
  assert.equal(rows[0].tradesCount, 2);
  assert.equal(rows[0].wins, 1);
  assert.equal(rows[0].losses, 1);
  const expectedJanCompound = ((1 + 50 / 1000) * (1 - 20 / 1000) - 1) * 100;
  assert.ok(Math.abs(rows[0].compoundedReturnPercent - expectedJanCompound) < 0.001);
  assert.equal(rows[1].month, '2024-02');
  assert.equal(rows[1].tradesCount, 1);
});

test('aggregateTradesByExitMonth uses ohlcv when exitTime missing', () => {
  const ohlcv = [
    { time: '2023-06-01T00:00:00.000Z' },
    { time: '2023-06-30T00:00:00.000Z' },
  ];
  const trades = [{ exitBar: 1, pnl: 10, investedAmount: 100, profitPercent: 10 }];
  const rows = aggregateTradesByExitMonth(trades, ohlcv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].month, '2023-06');
});
