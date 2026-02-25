/**
 * RSI Setup backtest simulation.
 * Walks through candles bar-by-bar, evaluates strategy, simulates exits (failure or eod).
 * No ATR stop/target - exit on failure conditions or end of data.
 */

import { evaluate } from './SwingStrategyEngine.js';
import { checkFailure } from './FailureDetector.js';
import { computeIndicatorSeries } from '../IndicatorService.js';

/**
 * Run RSI Setup backtest on a single symbol's OHLCV.
 * @param {Array<{ open, high, low, close, volume?, time? }>} ohlcv - Candles oldest first
 * @returns {{
 *   trades: Array<{ entryBar, exitBar, entryPrice, exitPrice, exitReason, pnl }>,
 *   winRate: number,
 *   totalReturn: number,
 *   avgR: number,
 *   tradesCount: number
 * }}
 */
export function runRsiSetupBacktest(ohlcv) {
  const trades = [];
  let equity = 1;
  const position = { entryBar: -1, entryPrice: 0 };

  for (let i = 50; i < ohlcv.length; i++) {
    const window = ohlcv.slice(0, i + 1);

    if (position.entryBar >= 0) {
      const c = ohlcv[i];
      let exitReason = null;
      let exitPrice = c.close;

      const series = computeIndicatorSeries(window);
      const failure = checkFailure({
        candles: window,
        rsi: series.rsi,
        ema50: null,
        entryIndex: position.entryBar,
        entryPrice: position.entryPrice,
        stopLoss: null,
      });
      if (failure.failureDetected) {
        exitReason = 'failure';
        exitPrice = c.close;
      }

      if (exitReason) {
        const pnl = exitPrice - position.entryPrice;
        equity *= 1 + pnl / position.entryPrice;
        trades.push({
          entryBar: position.entryBar,
          exitBar: i,
          entryPrice: position.entryPrice,
          exitPrice,
          exitReason,
          pnl,
        });
        position.entryBar = -1;
      }
      continue;
    }

    const result = evaluate(window);
    if (result.signal === 'BUY' && result.entryPrice != null) {
      position.entryBar = i;
      position.entryPrice = result.entryPrice;
    }
  }

  if (position.entryBar >= 0) {
    const last = ohlcv[ohlcv.length - 1];
    const pnl = last.close - position.entryPrice;
    trades.push({
      entryBar: position.entryBar,
      exitBar: ohlcv.length - 1,
      entryPrice: position.entryPrice,
      exitPrice: last.close,
      exitReason: 'eod',
      pnl,
    });
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  return {
    trades,
    tradesCount: trades.length,
    winRate: trades.length > 0 ? wins / trades.length : 0,
    totalReturn: equity - 1,
    avgR: 0,
  };
}

export default { runRsiSetupBacktest };
