import test from 'node:test';
import assert from 'node:assert/strict';
import { istStartOfCalendarDay, toDateStrIST } from '../utils/istExchangeDate.js';

test('toDateStrIST uses Asia/Kolkata calendar', () => {
  const d = new Date('2026-03-29T18:30:00.000Z');
  assert.equal(toDateStrIST(d), '2026-03-30');
});

test('istStartOfCalendarDay is 00:00 IST for that calendar day', () => {
  const anchor = new Date('2026-03-29T22:00:00.000Z');
  const start = istStartOfCalendarDay(anchor);
  assert.equal(toDateStrIST(start), '2026-03-30');
  assert.equal(start.getTime(), new Date('2026-03-29T18:30:00.000Z').getTime());
});
