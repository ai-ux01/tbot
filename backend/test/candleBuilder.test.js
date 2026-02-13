/**
 * Tests for CandleBuilder: addTick produces correct OHLC, candle emitted on bucket change.
 */
import test from 'node:test';
import assert from 'node:assert';
import { CandleBuilder, CandleBuilderEvents } from '../bot/CandleBuilder.js';

test('CandleBuilder addTick ignores invalid tick', () => {
  const cb = new CandleBuilder();
  cb.addTick(null);
  cb.addTick({});
  cb.addTick({ ltp: NaN });
  assert.strictEqual(cb.getCurrentCandle(), null);
  assert.strictEqual(cb.getCandles().length, 0);
});

test('CandleBuilder addTick creates current candle and emits on bucket change', () => {
  const cb = new CandleBuilder();
  const candles = [];
  cb.on(CandleBuilderEvents.CANDLE, (c) => candles.push(c));

  cb.addTick({ ltp: 100, time: 0 });
  let cur = cb.getCurrentCandle();
  assert(cur != null);
  assert.strictEqual(cur.time, 0);
  assert.strictEqual(cur.open, 100);
  assert.strictEqual(cur.high, 100);
  assert.strictEqual(cur.low, 100);
  assert.strictEqual(cur.close, 100);
  assert.strictEqual(candles.length, 0);

  cb.addTick({ ltp: 102, time: 60 });
  assert.strictEqual(candles.length, 1);
  assert.strictEqual(candles[0].time, 0);
  assert.strictEqual(candles[0].open, 100);
  assert.strictEqual(candles[0].high, 100);
  assert.strictEqual(candles[0].low, 100);
  assert.strictEqual(candles[0].close, 100);

  cb.addTick({ ltp: 99, time: 61 });
  cb.addTick({ ltp: 101, time: 119 });
  assert.strictEqual(candles.length, 1);

  cb.addTick({ ltp: 98, time: 120 });
  assert.strictEqual(candles.length, 2);
  assert.strictEqual(candles[1].time, 60);
  assert.strictEqual(candles[1].open, 102);
  assert.strictEqual(candles[1].high, 102);
  assert.strictEqual(candles[1].low, 99);
  assert.strictEqual(candles[1].close, 101);
});

test('CandleBuilder uses tick.close if ltp missing', () => {
  const cb = new CandleBuilder();
  cb.addTick({ close: 50, time: 0 });
  const cur = cb.getCurrentCandle();
  assert(cur != null);
  assert.strictEqual(cur.close, 50);
});
