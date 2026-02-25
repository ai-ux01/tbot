/**
 * RSI Momentum Reset (1D Only)
 * Strict structure-based state machine
 * No extra filters
 */

export class RSIMomentumResetStrategy {
  constructor(config = {}) {
    this.rsiLength = config.rsiLength || 14;
    this.rsiMaLength = config.rsiMaLength || 14;
    this.tolerancePercent = config.tolerancePercent ?? 0.5;
    this.pullback2Min = config.pullback2Min ?? 35;
    this.pullback2Max = config.pullback2Max ?? 60;

    this.reset();
  }

  reset() {
    this.state = 'WAIT_PEAK';
    this.low1_price = null;
    this.low1_index = null;
  }

  /** Wilder RSI */
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

    const rs = avgLoss === 0 ? (avgGain > 0 ? 100 : 1) : avgGain / avgLoss;
    rsi[this.rsiLength] = Math.min(100, Math.max(0, 100 - 100 / (1 + rs)));

    for (let i = this.rsiLength + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;

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
        if (values[i - j] == null || !Number.isFinite(values[i - j])) {
          valid = false;
          break;
        }
        sum += values[i - j];
      }

      if (valid) sma[i] = sum / length;
    }

    return sma;
  }

  deviationPercent(a, b) {
    if (b == null || b === 0) return Infinity;
    return Math.abs((a - b) / b) * 100;
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

    for (let i = 1; i < closes.length; i++) {
      const output = {
        signal: false,
        entryPrice: null,
        confidence: null,
        low1Index: this.low1_index,
        entryIndex: null,
      };

      if (!Number.isFinite(rsi[i]) || !Number.isFinite(rsiMA[i])) {
        results.push(output);
        continue;
      }

      const currentRSI = rsi[i];
      const prevRSI = rsi[i - 1];
      const currentClose = closes[i];

      switch (this.state) {
        // 1️⃣ Peak ≥ 70
        case 'WAIT_PEAK':
          if (currentRSI >= 70) {
            this.state = 'WAIT_LOW1';
          }
          break;

        // 2️⃣ First Pullback (35–45)
        case 'WAIT_LOW1':
          if (currentRSI >= 35 && currentRSI <= 45) {
            this.low1_price = currentClose;
            this.low1_index = i;
            this.state = 'WAIT_REBOUND';
          }
          break;

        // 3️⃣ Rebound (55–65)
        case 'WAIT_REBOUND':
          if (currentRSI >= 55 && currentRSI <= 65) {
            this.state = 'WAIT_SECOND_PULLBACK';
          }
          break;

        // 4️⃣ Second Pullback (RSI 35–60)
        case 'WAIT_SECOND_PULLBACK':
          if (
            currentRSI >= this.pullback2Min &&
            currentRSI <= this.pullback2Max &&
            this.low1_price != null
          ) {
            const deviation = this.deviationPercent(currentClose, this.low1_price);
            const priceMatch = deviation <= this.tolerancePercent;
            const rsiTurningUp = currentRSI > prevRSI;

            const rsiMaPrev = rsiMA[i - 1];
            const rsiTouchOrCross =
              currentRSI <= rsiMA[i] ||
              (Number.isFinite(rsiMaPrev) && prevRSI > rsiMaPrev && currentRSI <= rsiMA[i]);

            // SAME CANDLE VALIDATION
            if (priceMatch && rsiTurningUp && rsiTouchOrCross) {
              output.signal = true;
              output.entryPrice = currentClose;
              output.entryIndex = i;

              const rsiDelta = currentRSI - prevRSI;

              if (deviation <= 0.25 && rsiDelta > 2) {
                output.confidence = 'HIGH';
              } else if (rsiDelta > 1) {
                output.confidence = 'MEDIUM';
              } else {
                output.confidence = 'LOW';
              }

              this.reset();
            }
          }
          break;
      }

      results.push(output);
    }

    return results;
  }
}

export default RSIMomentumResetStrategy;
