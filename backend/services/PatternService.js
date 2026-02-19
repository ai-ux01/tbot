/**
 * Client for ML pattern detection service. Calls FastAPI /predict with OHLCV candles.
 * ML service is optional: when ML_SERVICE_URL is unset or "disabled", no request is made
 * and the SignalEngine uses rule-based pattern/trend only. When used, service typically runs on port 8000.
 */

import axios from 'axios';
import { logger } from '../logger.js';

const raw = process.env.ML_SERVICE_URL;
const DEFAULT_ML_URL = raw === '' || raw === 'disabled' ? '' : (raw || 'http://localhost:8000');
const TIMEOUT_MS = Number(process.env.ML_SERVICE_TIMEOUT_MS) || 10000;
const RETRIES = Number(process.env.ML_SERVICE_RETRIES) || 2;

/**
 * @param {Array<{ open: number, high: number, low: number, close: number, volume?: number }>} candles
 * @returns {Promise<{ pattern: string, probability: number, trend_prediction: string } | null>}
 */
export async function predictPattern(candles) {
  if (!DEFAULT_ML_URL) {
    return null;
  }
  if (!Array.isArray(candles) || candles.length < 50) {
    logger.warn('PatternService: insufficient candles', { count: candles?.length });
    return null;
  }
  const payload = {
    candles: candles.slice(-500).map((c) => ({
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume) || 0,
    })),
  };
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await axios.post(`${DEFAULT_ML_URL}/predict`, payload, {
        timeout: TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
      });
      const data = res.data;
      if (data && typeof data.probability === 'number') {
        return {
          pattern: data.pattern || 'Unknown',
          probability: Math.min(1, Math.max(0, data.probability)),
          trend_prediction: (data.trend_prediction || 'NEUTRAL').toUpperCase(),
        };
      }
      return null;
    } catch (err) {
      lastErr = err;
      logger.warn('PatternService: predict attempt failed', {
        attempt: attempt + 1,
        error: err?.message,
        code: err?.code,
      });
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  logger.error('PatternService: all predict attempts failed', { error: lastErr?.message });
  return null;
}

export default { predictPattern };
