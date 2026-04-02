import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePaperExecutionPrices } from '../services/PaperTradingService.js';

test('rsi-ma-setup-copy BUY uses strategy entryPrice over signal-bar close', () => {
  const { priceForBuyOpen, priceForExit } = resolvePaperExecutionPrices('rsi-ma-setup-copy', {
    entryPrice: 729.95,
    currentPrice: 800,
  });
  assert.equal(priceForBuyOpen, 729.95);
  assert.equal(priceForExit, 800);
});

test('eighty-percent BUY prefers entryPrice when both set', () => {
  const { priceForBuyOpen } = resolvePaperExecutionPrices('eighty-percent', {
    entryPrice: 100,
    currentPrice: 105,
  });
  assert.equal(priceForBuyOpen, 100);
});

test('rsi-setup BUY still prefers currentPrice (latest bar)', () => {
  const { priceForBuyOpen } = resolvePaperExecutionPrices('rsi-setup', {
    entryPrice: 100,
    currentPrice: 105,
  });
  assert.equal(priceForBuyOpen, 105);
});
