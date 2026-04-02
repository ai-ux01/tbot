import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBacktestRequest } from '../services/backtestRunPersistence.js';

test('sanitizeBacktestRequest strips candles and records length', () => {
  const req = {
    query: { a: '1' },
    body: { symbol: 'X', candles: [1, 2, 3] },
  };
  const s = sanitizeBacktestRequest(req);
  assert.deepEqual(s.query, { a: '1' });
  assert.equal(s.body.symbol, 'X');
  assert.equal(s.body._candlesLength, 3);
  assert.equal('candles' in s.body, false);
});

test('sanitizeBacktestRequest handles missing body', () => {
  const s = sanitizeBacktestRequest({ query: {} });
  assert.deepEqual(s.query, {});
  assert.deepEqual(s.body, {});
});
