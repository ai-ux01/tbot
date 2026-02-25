/**
 * RSI Momentum Reset in Uptrend (1D Only)
 * Strict state machine implementation
 */

export class RSIMomentumResetStrategy {
  constructor(config = {}) {
    this.rsiLength = config.rsiLength || 14;
    this.rsiMaLength = config.rsiMaLength || 14;
    this.tolerancePercent = config.tolerancePercent ?? 0.5;

    this.resetStructure();
  }

  resetStructure() {
    this.state = 'WAITING_FOR_PEAK';

    this.low1_price = null;
    this.low1_rsi = null;
    this.low1_index = null;

    this.peakDetected = false;
    this.reboundDetected = false;
  }

  /** RSI Calculation (Wilder's smoothing) */
  calculateRSI(closes) {
    const rsi = new Array(closes.length).fill(null);

    if (closes.length < this.rsiLength + 1) return rsi;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= this.rsiLength; i++) {
      const change = closes[i] - closes[i - 1];
      if (change >= 0) gains += change;
      else losses += Math.abs(change);
    }

    let avgGain = gains / this.rsiLength;
    let avgLoss = losses / this.rsiLength;

    const rs = avgLoss === 0 ? (avgGain > 0 ? 100 : 1) : avgGain / avgLoss;
    rsi[this.rsiLength] = Math.min(100, Math.max(0, 100 - 100 / (1 + rs)));

    for (let i = this.rsiLength + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (this.rsiLength - 1) + gain) / this.rsiLength;
      avgLoss = (avgLoss * (this.rsiLength - 1) + loss) / this.rsiLength;

      const rsVal = avgLoss === 0 ? (avgGain > 0 ? 100 : 1) : avgGain / avgLoss;
      rsi[i] = Math.min(100, Math.max(0, 100 - 100 / (1 + rsVal)));
    }

    return rsi;
  }

  calculateSMA(values, length) {
    const sma = new Array(values.length).fill(null);

    for (let i = length - 1; i < values.length; i++) {
      let sum = 0;
      let valid = true;

      for (let j = 0; j < length; j++) {
        const v = values[i - j];
        if (v == null || !Number.isFinite(v)) {
          valid = false;
          break;
        }
        sum += v;
      }

      if (valid) sma[i] = sum / length;
    }

    return sma;
  }

  withinRange(value, min, max) {
    return value != null && Number.isFinite(value) && value >= min && value <= max;
  }

  priceDeviationPercent(price1, price2) {
    if (price2 == null || price2 === 0) return Infinity;
    return Math.abs((price1 - price2) / price2) * 100;
  }

  /**
   * Evaluate bar-by-bar. Returns array of { signal, entryPrice, confidence, low1Index, entryIndex } per bar.
   * @param {number[]} closes - Close prices
   * @returns {Array<{ signal: boolean, entryPrice: number|null, confidence: string|null, low1Index: number|null, entryIndex: number|null }>}
   */
  evaluate(closes) {
    const rsi = this.calculateRSI(closes);
    const rsiMA = this.calculateSMA(rsi, this.rsiMaLength);

    const results = [];

    for (let i = 0; i < closes.length; i++) {
      const signal = {
        signal: false,
        entryPrice: null,
        confidence: null,
        low1Index: this.low1_index,
        entryIndex: null,
      };

      if (i < 1 || !Number.isFinite(rsi[i]) || !Number.isFinite(rsiMA[i])) {
        results.push(signal);
        continue;
      }

      const currentRSI = rsi[i];
      const prevRSI = rsi[i - 1];
      const currentClose = closes[i];
      const rsiMaCurr = rsiMA[i];
      const rsiMaPrev = rsiMA[i - 1];

      if (prevRSI == null || !Number.isFinite(prevRSI)) {
        results.push(signal);
        continue;
      }

      switch (this.state) {
        case 'WAITING_FOR_PEAK':
          if (currentRSI >= 70) {
            this.state = 'WAITING_FOR_LOW1';
          }
          break;

        case 'WAITING_FOR_LOW1':
          if (this.withinRange(currentRSI, 35, 45)) {
            this.low1_price = currentClose;
            this.low1_rsi = currentRSI;
            this.low1_index = i;
            this.state = 'WAITING_FOR_REBOUND';
          }
          break;

        case 'WAITING_FOR_REBOUND':
          if (this.withinRange(currentRSI, 55, 65)) {
            this.state = 'WAITING_FOR_SECOND_PULLBACK';
          }
          break;

        case 'WAITING_FOR_SECOND_PULLBACK':
          if (this.withinRange(currentRSI, 35, 45) && this.low1_price != null) {
            const deviation = this.priceDeviationPercent(currentClose, this.low1_price);
            const priceMatch = deviation <= this.tolerancePercent;
            const rsiTurningUp = currentRSI > prevRSI;

            const rsiTouchOrCross =
              currentRSI <= rsiMaCurr ||
              (rsiMaPrev != null && prevRSI > rsiMaPrev && currentRSI <= rsiMaCurr);

            if (priceMatch && rsiTurningUp && rsiTouchOrCross) {
              signal.signal = true;
              signal.entryPrice = currentClose;
              signal.entryIndex = i;

              const rsiDelta = currentRSI - prevRSI;

              if (deviation <= 0.25 && rsiDelta > 2) {
                signal.confidence = 'HIGH';
              } else if (deviation <= this.tolerancePercent && rsiDelta > 1) {
                signal.confidence = 'MEDIUM';
              } else {
                signal.confidence = 'LOW';
              }

              this.resetStructure();
            }
          }
          break;
      }

      results.push(signal);
    }

    return results;
  }
}

export default RSIMomentumResetStrategy;
