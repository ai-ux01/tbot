import test from 'node:test';
import assert from 'node:assert';
import { exitMonthUtc, exitMonthIst } from '../services/paperTradePersistence.js';

test('exitMonthUtc / exitMonthIst for known instant', () => {
  const iso = '2025-03-15T12:00:00.000Z';
  assert.strictEqual(exitMonthUtc(iso), '2025-03');
  assert.strictEqual(exitMonthIst(iso), '2025-03');
});

test('exitMonthIst crosses UTC month boundary', () => {
  const iso = '2025-03-31T18:30:00.000Z';
  assert.strictEqual(exitMonthUtc(iso), '2025-03');
  assert.strictEqual(exitMonthIst(iso), '2025-04');
});
