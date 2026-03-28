/**
 * RSI Momentum Reset (1D Only)
 * Peak ≥ 70 → Low1 (below 45) → lowest low after peak through bar before rebound (above 55) → near/cross RSI SMA
 * Entry: close ≈ low1_price (tolerance %), and RSI SMA must be rising (current MA > prior bar MA).
 * Exit (in backtest): when RSI touches 70 again (setup complete); EOD only if data ends before that
 */

export class RSIMomentumResetStrategy {
  constructor(config = {}) {
    this.rsiLength = config.rsiLength || 14;
    this.rsiMaLength = config.rsiMaLength || 14;
    this.lookbackDays = config.lookbackDays || 30; // 20–30 days window
    this.tolerancePercent = config.tolerancePercent ?? 0.5;
    this.rsiPeakThreshold = config.rsiPeakThreshold ?? 70;
    this.low1Min = config.low1Min ?? 35;
    this.low1Max = config.low1Max ?? 45;
    this.reboundMin = config.reboundMin ?? 55;
    this.reboundMax = config.reboundMax ?? 65;
    /** RSI points: symmetric nearness to MA */
    this.maTouchTolerance = config.maTouchTolerance ?? 2.5;
    /** RSI points: allow RSI slightly above MA (e.g. shallow pullback to MA) */
    this.maTouchAboveSlack = config.maTouchAboveSlack ?? 3.5;

    this.reset();
  }

  reset() {
    this.state = 'WAIT_PEAK';
    this.peak_price = null;
    this.peak_index = null;
    this.low1_price = null;
    this.low1_index = null;
    this.rebound_price = null;
    this.rebound_index = null;
    /** Min candle low from bar after peak through bar before rebound leg (excludes rebound day) */
    this.preReboundMinLow = null;
    this.preReboundMinLowIndex = null;
  }

  // Wilder RSI
  calculateRSI(closes) {
    const rsi = new Array(closes.length).fill(null);
    if (closes.length < this.rsiLength + 1) return rsi;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= this.rsiLength; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }

    let avgGain = gains / this.rsiLength;
    let avgLoss = losses / this.rsiLength;

    rsi[this.rsiLength] =
      100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));

    for (let i = this.rsiLength + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;

      avgGain = (avgGain * (this.rsiLength - 1) + gain) / this.rsiLength;
      avgLoss = (avgLoss * (this.rsiLength - 1) + loss) / this.rsiLength;

      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi[i] = 100 - 100 / (1 + rs);
    }

    return rsi;
  }

  calculateSMA(values, length) {
    const sma = new Array(values.length).fill(null);

    for (let i = length - 1; i < values.length; i++) {
      const slice = values.slice(i - length + 1, i + 1);
      if (slice.some(v => !Number.isFinite(v))) continue;

      const sum = slice.reduce((a, b) => a + b, 0);
      sma[i] = sum / length;
    }

    return sma;
  }

  deviationPercent(a, b) {
    if (!Number.isFinite(b) || b === 0) return Infinity;
    return Math.abs((a - b) / b) * 100;
  }

  /**
   * @param {Array<{ close: number, low?: number, high?: number }>} candles - OHLC; low/high default to close
   */
  evaluate(candles) {
    const closes = candles.map((c) => c.close);
    const lows = candles.map((c, i) =>
      typeof c.low === 'number' && Number.isFinite(c.low) ? c.low : closes[i]
    );
    const highs = candles.map((c, i) =>
      typeof c.high === 'number' && Number.isFinite(c.high) ? c.high : closes[i]
    );
    const rsi = this.calculateRSI(closes);
    const rsiMA = this.calculateSMA(rsi, this.rsiMaLength);

    const results = [];

    // Scan from first bar where RSI and RSI SMA are both valid so we capture all setups in history
    const start = Math.max(0, this.rsiLength + this.rsiMaLength - 1);

    for (let i = start + 1; i < closes.length; i++) {
      const output = {
        signal: false,
        entryPrice: null,
        entryIndex: null,
        peakPrice: null,
        peakIndex: null,
        low1Price: null,
        low1Index: null,
        preReboundLowPrice: null,
        preReboundLowIndex: null,
        reboundPrice: null,
        reboundIndex: null,
      };

      if (!Number.isFinite(rsi[i]) || !Number.isFinite(rsiMA[i])) {
        results.push(output);
        continue;
      }

      const currentRSI = rsi[i];
      const prevRSI = rsi[i - 1];
      const currentMA = rsiMA[i];
      const prevMA = rsiMA[i - 1];
      const currentClose = closes[i];
      const currentLow = lows[i];
      const currentHigh = highs[i];

      switch (this.state) {
        case 'WAIT_PEAK':
          if (currentRSI >= this.rsiPeakThreshold) {
            this.peak_price = currentClose;
            this.peak_index = i;
            this.preReboundMinLow = null;
            this.preReboundMinLowIndex = null;
            this.state = 'WAIT_LOW1';
          }
          break;

        case 'WAIT_LOW1':
          // Pullback low: any bar strictly after peak, before first rebound bar (rebound bar excluded later)
          if (
            this.peak_index != null &&
            i > this.peak_index &&
            Number.isFinite(currentLow)
          ) {
            if (this.preReboundMinLow == null || currentLow < this.preReboundMinLow) {
              this.preReboundMinLow = currentLow;
              this.preReboundMinLowIndex = i;
            }
          }
          if (currentRSI >= this.low1Min && currentRSI <= this.low1Max) {
            this.low1_price = currentClose;
            this.low1_index = i;
            this.state = 'WAIT_REBOUND';
          }
          break;

        case 'WAIT_REBOUND':
          if (currentRSI >= this.reboundMin && currentRSI <= this.reboundMax) {
            /** Chart-aligned: rebound leg uses session high (close alone often mismatches chart) */
            this.rebound_price = Number.isFinite(currentHigh) ? currentHigh : currentClose;
            this.rebound_index = i;
            this.state = 'WAIT_MA_TOUCH';
          } else if (
            this.peak_index != null &&
            i > this.peak_index &&
            Number.isFinite(currentLow)
          ) {
            if (this.preReboundMinLow == null || currentLow < this.preReboundMinLow) {
              this.preReboundMinLow = currentLow;
              this.preReboundMinLowIndex = i;
            }
          }
          break;

        case 'WAIT_MA_TOUCH': {
          const crossedBelowMA =
            Number.isFinite(prevMA) &&
            prevRSI > prevMA &&
            currentRSI <= currentMA;

          const nearMA =
            Number.isFinite(currentMA) &&
            Number.isFinite(currentRSI) &&
            (Math.abs(currentRSI - currentMA) <= this.maTouchTolerance ||
              (currentRSI > currentMA &&
                currentRSI - currentMA <= this.maTouchAboveSlack));

          /** RSI moving average of RSI must slope upward at entry */
          const rsiMaRising =
            Number.isFinite(prevMA) && currentMA > prevMA;

          const deviation =
            this.low1_price != null
              ? this.deviationPercent(currentClose, this.low1_price)
              : Infinity;

          if (
            rsiMaRising &&
            (crossedBelowMA || nearMA) &&
            deviation <= this.tolerancePercent
          ) {
            output.signal = true;
            output.entryPrice = currentClose;
            output.entryIndex = i;
            output.peakPrice = this.peak_price;
            output.peakIndex = this.peak_index;
            output.low1Price = this.low1_price;
            output.low1Index = this.low1_index;
            output.preReboundLowPrice = this.preReboundMinLow;
            output.preReboundLowIndex = this.preReboundMinLowIndex;
            output.reboundPrice = this.rebound_price;
            output.reboundIndex = this.rebound_index;

            this.reset();
          }
          break;
        }
      }

      results.push(output);
    }

    return results;
  }
}

export default RSIMomentumResetStrategy;
