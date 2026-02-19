/**
 * Rule-based indicator engine: EMA, RSI, MACD, Bollinger Bands, volume breakout.
 * No external indicator libraries; manual calculations for performance.
 * Output: { ema20, ema50, ema200, rsi, macd, bollingerBands, volumeSignal, ruleSignal }.
 */

const RSI_PERIOD = 14;
const EMA_PERIODS = [20, 50, 200];
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const BB_PERIOD = 20;
const BB_STD = 2;
const VOLUME_LOOKBACK = 20;

/**
 * SMA of array (last `period` values).
 */
function sma(arr, period) {
  if (!Array.isArray(arr) || arr.length < period) return null;
  const slice = arr.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

/**
 * EMA: k = 2/(period+1), ema = price * k + ema_prev * (1-k). Seed with SMA of first period.
 */
function emaSeries(data, period) {
  if (!Array.isArray(data) || data.length < period) return [];
  const out = [];
  const k = 2 / (period + 1);
  let ema = sma(data.slice(0, period), period);
  for (let i = 0; i < period - 1; i++) out.push(null);
  out.push(ema);
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

/**
 * RSI (Wilder smoothing). Returns last value or null.
 */
function rsi(closes, period = RSI_PERIOD) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let j = 1; j <= period; j++) {
    const ch = closes[j] - closes[j - 1];
    if (ch > 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const ch = closes[i] - closes[i - 1];
      const g = ch > 0 ? ch : 0;
      const l = ch < 0 ? -ch : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
    }
    const rs = avgLoss === 0 ? (avgGain > 0 ? Infinity : 1) : avgGain / avgLoss;
    const r = avgLoss === 0 && avgGain === 0 ? 50 : (avgGain === 0 ? 0 : 100 - 100 / (1 + rs));
    if (i === closes.length - 1) return Math.min(100, Math.max(0, r));
  }
  return null;
}

/**
 * MACD: fast EMA - slow EMA, signal EMA of MACD, histogram = macd - signal.
 */
function macd(closes) {
  if (!Array.isArray(closes) || closes.length < MACD_SLOW + MACD_SIGNAL) return null;
  const fastEma = emaSeries(closes, MACD_FAST);
  const slowEma = emaSeries(closes, MACD_SLOW);
  const macdLine = fastEma.map((f, i) => (f != null && slowEma[i] != null ? f - slowEma[i] : null));
  const validMacd = macdLine.filter((m) => m != null);
  if (validMacd.length < MACD_SIGNAL) return null;
  const signalEma = emaSeries(validMacd, MACD_SIGNAL);
  const lastMacd = validMacd[validMacd.length - 1];
  const lastSignal = signalEma[signalEma.length - 1];
  const histogram = lastMacd != null && lastSignal != null ? lastMacd - lastSignal : null;
  return {
    macd: lastMacd,
    signal: lastSignal,
    histogram,
    bullish: histogram != null ? histogram > 0 : null,
  };
}

/**
 * Bollinger Bands: middle = SMA(20), upper = middle + 2*std, lower = middle - 2*std.
 */
function bollingerBands(closes, period = BB_PERIOD, mult = BB_STD) {
  if (!Array.isArray(closes) || closes.length < period) return null;
  const mid = sma(closes.slice(-period), period);
  if (mid == null) return null;
  const slice = closes.slice(-period);
  const variance = slice.reduce((acc, c) => acc + (c - mid) ** 2, 0) / period;
  const std = Math.sqrt(variance) || 0;
  const upper = mid + mult * std;
  const lower = mid - mult * std;
  const lastClose = closes[closes.length - 1];
  const position = lastClose <= lower ? 'below' : lastClose >= upper ? 'above' : 'inside';
  return { upper, middle: mid, lower, position };
}

/**
 * Volume breakout: current volume vs SMA(volume, lookback). Returns 'breakout' | 'normal' | null.
 */
function volumeSignal(volumes, lookback = VOLUME_LOOKBACK) {
  if (!Array.isArray(volumes) || volumes.length < lookback + 1) return null;
  const recent = volumes.slice(-lookback);
  const avgVol = recent.reduce((a, b) => a + b, 0) / lookback;
  const current = volumes[volumes.length - 1];
  if (avgVol <= 0) return 'normal';
  const ratio = current / avgVol;
  return ratio >= 1.5 ? 'breakout' : 'normal';
}

/**
 * Rule-based signal: BUY | SELL | HOLD from indicators.
 */
function computeRuleSignal(indicators) {
  const { ema20, ema50, ema200, rsi: rsiVal, macd: macdObj, bollingerBands: bb, volumeSignal: volSig } = indicators;
  let buyScore = 0;
  let sellScore = 0;

  if (ema20 != null && ema50 != null) {
    if (ema20 > ema50) buyScore += 1;
    else if (ema20 < ema50) sellScore += 1;
  }
  if (ema50 != null && ema200 != null) {
    if (ema50 > ema200) buyScore += 1;
    else if (ema50 < ema200) sellScore += 1;
  }
  if (rsiVal != null) {
    if (rsiVal < 30) buyScore += 1;
    else if (rsiVal > 70) sellScore += 1;
  }
  if (macdObj?.bullish === true) buyScore += 1;
  else if (macdObj?.bullish === false) sellScore += 1;
  if (bb?.position === 'below') buyScore += 1;
  else if (bb?.position === 'above') sellScore += 1;
  if (volSig === 'breakout') {
    buyScore += 0.5;
    sellScore += 0.5;
  }

  if (buyScore > sellScore && buyScore >= 2) return 'BUY';
  if (sellScore > buyScore && sellScore >= 2) return 'SELL';
  return 'HOLD';
}

/**
 * Compute indicator strength score in [0, 1] for signal engine.
 */
function indicatorStrengthScore(indicators) {
  const { ruleSignal, rsi: rsiVal, macd: macdObj } = indicators;
  let score = 0.5;
  if (ruleSignal === 'BUY') score += 0.2;
  else if (ruleSignal === 'SELL') score -= 0.2;
  if (rsiVal != null) {
    if (rsiVal < 30 || rsiVal > 70) score += 0.15;
  }
  if (macdObj?.histogram != null && Math.abs(macdObj.histogram) > 0) score += 0.1;
  return Math.min(1, Math.max(0, score));
}

/**
 * @param {Array<{ open: number, high: number, low: number, close: number, volume?: number }>} ohlcv
 * @returns {{ ema20, ema50, ema200, rsi, macd, bollingerBands, volumeSignal, ruleSignal, indicatorStrength }}
 */
export function computeIndicators(ohlcv) {
  if (!Array.isArray(ohlcv) || ohlcv.length === 0) {
    return {
      ema20: null,
      ema50: null,
      ema200: null,
      rsi: null,
      macd: null,
      bollingerBands: null,
      volumeSignal: null,
      ruleSignal: 'HOLD',
      indicatorStrength: 0.5,
    };
  }
  const closes = ohlcv.map((c) => Number(c.close)).filter(Number.isFinite);
  const volumes = ohlcv.map((c) => Number(c.volume) || 0);

  const ema20 = closes.length >= 20 ? emaSeries(closes, 20).pop() : null;
  const ema50 = closes.length >= 50 ? emaSeries(closes, 50).pop() : null;
  const ema200 = closes.length >= 200 ? emaSeries(closes, 200).pop() : null;
  const rsiVal = rsi(closes, RSI_PERIOD);
  const macdObj = macd(closes);
  const bb = bollingerBands(closes);
  const volSig = volumeSignal(volumes);

  const indicators = {
    ema20,
    ema50,
    ema200,
    rsi: rsiVal,
    macd: macdObj,
    bollingerBands: bb,
    volumeSignal: volSig,
  };
  const ruleSignal = computeRuleSignal(indicators);
  const indicatorStrength = indicatorStrengthScore({ ...indicators, ruleSignal });

  return {
    ...indicators,
    ruleSignal,
    indicatorStrength,
  };
}

export default { computeIndicators };
