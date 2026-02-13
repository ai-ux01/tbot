/**
 * Tests for BotEngine: start validation and strategy signal path.
 */
import test from 'node:test';
import assert from 'node:assert';
import { BotEngine, BotState } from '../bot/BotEngine.js';
import { createStrategy } from '../strategies/index.js';

test('BotEngine start rejects when session missing', async () => {
  const engine = new BotEngine({ instrumentToken: 'nse_cm|1' });
  await assert.rejects(engine.start(), /session|required/);
});

test('BotEngine start rejects when instrumentToken missing', async () => {
  const engine = new BotEngine({
    session: { auth: 'a', sid: 's' },
    instrumentToken: null,
  });
  await assert.rejects(engine.start(), /instrumentToken|required/);
});

test('BotEngine start rejects when instrumentToken empty array', async () => {
  const engine = new BotEngine({
    session: { auth: 'a', sid: 's' },
    instrumentToken: [],
  });
  await assert.rejects(engine.start(), /instrumentToken|required/);
});

test('strategy signal path: candle → onCandle returns valid payload when BUY/SELL', () => {
  const strategy = createStrategy('emaCross');
  const context = { symbol: 'TEST' };
  let lastSignal = null;
  for (let i = 0; i < 35; i++) {
    const c = { time: i * 60, open: 100, high: 101, low: 99, close: 100 + (i % 5) - 2 };
    const out = strategy.onCandle(c, context);
    if (out && (out.signal === 'BUY' || out.signal === 'SELL')) {
      assert.strictEqual(typeof out.signal, 'string');
      assert(out.candle && typeof out.candle.close === 'number');
      assert(['FLAT', 'LONG'].includes(out.state));
      lastSignal = out;
    }
  }
  assert(['FLAT', 'LONG'].includes(strategy.getState()));
});
