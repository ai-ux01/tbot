/**
 * Signals API: list signals, get indicators, trigger evaluation.
 */

import { Router } from 'express';
import { Signal } from '../database/models/Signal.js';
import { isDbConnected } from '../database/connection.js';
import { computeIndicators, computeIndicatorSeries } from '../services/IndicatorService.js';
import { rsiSwingBuyStrategy } from '../services/strategies/RsiSetupStrategy.js';
import {
  evaluateAndPersistSignal,
  getCandlesForSignal,
  getSymbolsWithStoredCandles,
  utcDayStartFromInput,
  utcDayEndFromInput,
} from '../services/SignalEngine.js';
import { evaluate as evaluateRsiSetup, evaluateAllSetups, runRsiSetupBacktest, normalizeRsiSetupMode } from '../services/rsi-setup/index.js';
import { evaluate as evaluateEmaCrossover } from '../services/emaCrossover.js';
import {
  evaluate as evaluateEightyPercent,
  evaluateAllSetups as evaluateEightyPercentAllSetups,
  runBacktest as runEightyPercentBacktest,
  MIN_STOCK_PRICE as EIGHTY_PERCENT_MIN_PRICE,
  RSI_ARM_LEVEL as EIGHTY_PERCENT_RSI_ARM,
  RSI_PRECONDITION_LEVEL as EIGHTY_PERCENT_RSI_PRECONDITION,
} from '../services/eightyPercentSetup.js';
import {
  evaluate as evaluateRsiMaSetupCopyLastBar,
  evaluateAllSetups as evaluateRsiMaSetupCopyAllSetups,
  runBacktest as runRsiMaSetupCopyBacktest,
  MIN_STOCK_PRICE as RSI_MA_COPY_MIN_PRICE,
  RSI_ARM_LEVEL as RSI_MA_COPY_RSI_ARM,
  RSI_PRECONDITION_LEVEL as RSI_MA_COPY_RSI_PRECONDITION,
  RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PCT,
  RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT,
  RSI_MA_COPY_DEFAULT_PARTIAL_TP_FRACTION,
  planRsiMaCopyTradeLevels,
  resolveRsiMaCopyEvalOpts,
} from '../services/rsiMaSetupCopy.js';
import { aggregateDailyToMonthly, normalizeBacktestSeries } from '../services/candleAggregate.js';
import { aggregateTradesByExitMonth } from '../services/backtestMonthlyBreakdown.js';
import { runBacktest } from '../bot/BacktestingEngine.js';
import { persistBacktestRun, sanitizeBacktestRequest } from '../services/backtestRunPersistence.js';

const RSI_MA_DAILY_FETCH_FOR_MONTHLY = 5000;
const RSI_MA_MIN_MONTHLY_BARS = 30;
const RSI_MA_MIN_DAILY_BARS = 30;

/**
 * Optional `fromDate` / `toDate` (YYYY-MM-DD, UTC calendar day) for RSI↓MA Setup (copy) only.
 * @returns {{ range: null } | { range: { filterFrom: Date|null, filterTo: Date, candleOpts: object } } | { error: string }}
 */
function parseRsiMaCopyDateRangePayload(query = {}, body = {}) {
  const fromRaw = body.fromDate ?? body.from ?? query.fromDate ?? query.from;
  const toRaw = body.toDate ?? body.to ?? query.toDate ?? query.to;
  const hasFrom = fromRaw != null && String(fromRaw).trim() !== '';
  const hasTo = toRaw != null && String(toRaw).trim() !== '';
  if (!hasFrom && !hasTo) return { range: null };

  const filterFrom = hasFrom ? utcDayStartFromInput(fromRaw) : null;
  if (hasFrom && !filterFrom) return { error: 'Invalid fromDate (use YYYY-MM-DD)' };

  let filterTo;
  if (hasTo) {
    filterTo = utcDayEndFromInput(toRaw);
    if (!filterTo) return { error: 'Invalid toDate (use YYYY-MM-DD)' };
  } else {
    filterTo = utcDayEndFromInput(new Date());
  }

  if (hasFrom && hasTo && filterFrom.getTime() > filterTo.getTime()) {
    return { error: 'fromDate must be on or before toDate' };
  }

  const candleOpts = {};
  if (hasFrom) candleOpts.from = filterFrom;
  if (hasTo) candleOpts.to = utcDayEndFromInput(toRaw);

  return {
    range: {
      filterFrom,
      filterTo,
      candleOpts,
    },
  };
}

function filterTradesByRsiMaCopyDateRange(trades, filterFrom, filterTo) {
  if (!Array.isArray(trades) || (!filterFrom && !filterTo)) return trades;
  const lo = filterFrom ? filterFrom.getTime() : -Infinity;
  const hi = filterTo ? filterTo.getTime() : Infinity;
  return trades.filter((tr) => {
    const et = tr?.entryTime;
    if (et == null) return false;
    const ms = et instanceof Date ? et.getTime() : new Date(et).getTime();
    if (Number.isNaN(ms)) return false;
    return ms >= lo && ms <= hi;
  });
}

function recomputeRsiMaCopyBacktestSummary(result, filteredTrades) {
  const wins = filteredTrades.filter((t) => Number(t?.pnl) > 0).length;
  let equity = 1;
  for (const x of filteredTrades) {
    const inv = Number(x?.investedAmount) || 0;
    if (inv > 0) equity *= 1 + (Number(x?.pnl) || 0) / inv;
  }
  return {
    ...result,
    trades: filteredTrades,
    tradesCount: filteredTrades.length,
    winRate: filteredTrades.length ? wins / filteredTrades.length : 0,
    totalReturn: filteredTrades.length ? equity - 1 : 0,
  };
}

function applyRsiMaCopyDateRangeToBacktestResult(result, loadedOhlcv, filterFrom, filterTo) {
  if (!filterFrom && !filterTo) return { result, monthlyBreakdown: aggregateTradesByExitMonth(result.trades, loadedOhlcv) };
  const ft = filterTradesByRsiMaCopyDateRange(result.trades, filterFrom, filterTo);
  const adj = recomputeRsiMaCopyBacktestSummary(result, ft);
  return {
    result: adj,
    monthlyBreakdown: aggregateTradesByExitMonth(ft, loadedOhlcv),
  };
}

function signalEntryInRsiMaCopyDateRange(entryTime, filterFrom, filterTo) {
  if (!filterFrom && !filterTo) return true;
  const t = entryTime instanceof Date ? entryTime.getTime() : new Date(entryTime).getTime();
  if (Number.isNaN(t)) return false;
  if (filterFrom && t < filterFrom.getTime()) return false;
  if (filterTo && t > filterTo.getTime()) return false;
  return true;
}

/**
 * Load OHLCV for RSI↓MA / eighty-percent backtests: daily bars, or daily aggregated to monthly (UTC month).
 * @param {object|null} candleRange - `{ candleOpts }` from parseRsiMaCopyDateRangePayload (copy backtest only); omit for default last-N fetch.
 */
async function loadOhlcvRsiMaBacktest(symbol, series, candleRange = null) {
  const mode = normalizeBacktestSeries(series);
  const fetchOpts = candleRange?.candleOpts && Object.keys(candleRange.candleOpts).length > 0 ? candleRange.candleOpts : undefined;
  if (mode === 'month') {
    const dailies = await getCandlesForSignal(symbol, 'day', RSI_MA_DAILY_FETCH_FOR_MONTHLY, fetchOpts);
    const months = aggregateDailyToMonthly(dailies);
    if (months.length < RSI_MA_MIN_MONTHLY_BARS) {
      return {
        ok: false,
        status: 422,
        body: {
          error: `Insufficient monthly bars (${months.length}, need ≥${RSI_MA_MIN_MONTHLY_BARS}). Loaded ${dailies.length} daily candles (max ${RSI_MA_DAILY_FETCH_FOR_MONTHLY}).`,
          dailyBarsUsed: dailies.length,
          monthlyBars: months.length,
          barUnit: 'month',
        },
      };
    }
    const ohlcv = months.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0,
      time: c.time,
    }));
    return { ok: true, ohlcv, barUnit: 'month', dailyBarsUsed: dailies.length, monthlyBars: months.length };
  }
  const candles = await getCandlesForSignal(symbol, 'day', 500, fetchOpts);
  if (candles.length < RSI_MA_MIN_DAILY_BARS) {
    return {
      ok: false,
      status: 422,
      body: {
        error: `Insufficient daily candles (${candles.length}, need ≥${RSI_MA_MIN_DAILY_BARS})`,
        dailyBarsUsed: candles.length,
        barUnit: 'day',
      },
    };
  }
  const ohlcv = candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
    time: c.time,
  }));
  return { ok: true, ohlcv, barUnit: 'day', dailyBarsUsed: candles.length, monthlyBars: null };
}

function sumTradesInvestedAndPnl(trades) {
  let totalInvestedAmount = 0;
  let totalPnl = 0;
  if (!Array.isArray(trades)) return { totalInvestedAmount, totalPnl };
  for (const t of trades) {
    totalInvestedAmount += Number(t?.investedAmount) || 0;
    totalPnl += Number(t?.pnl) || 0;
  }
  return { totalInvestedAmount, totalPnl };
}

/** Drop `trades` from each row so combined backtest JSON stays small; UI loads trades via POST per symbol. */
function toCombinedBacktestRow(result, monthlyBreakdown, symbol, tradingsymbol) {
  const { trades: _omitTrades, ...rest } = result;
  return {
    symbol,
    tradingsymbol: tradingsymbol ?? symbol,
    monthlyBreakdown,
    ...rest,
  };
}

/**
 * Returns an array of rows: one per BUY setup in the lookback window. If no setups, one HOLD row so symbol still appears.
 */
async function evaluateRsiSetupForSymbol(symbol, tradingsymbol, timeframe, mode = 'strict', thresholds = {}) {
  const candles = await getCandlesForSignal(symbol, timeframe, 500);
  if (candles.length < 50) return null;
  const ohlcv = candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
  }));
  const { setups, lastResult } = evaluateAllSetups(ohlcv, { mode, thresholds });
  const indicators = computeIndicators(ohlcv);
  const rsiValue = indicators?.rsi != null && Number.isFinite(indicators.rsi) ? Math.round(indicators.rsi * 100) / 100 : null;
  const lastCandle = candles[candles.length - 1];
  const currentPrice =
    lastCandle?.close != null && Number.isFinite(Number(lastCandle.close)) ? Number(lastCandle.close) : null;
  const now = new Date();
  const rows = [];

  if (setups.length > 0) {
    for (const s of setups) {
      const entryTime = candles[s.entryIndex]?.time ?? null;
      const explanation =
        s.explanation ||
        lastResult?.explanation ||
        'RSI momentum reset: Peak ≥70 → Low1 (below 45) → lowest price before rebound (above 55) → rebound → RSI near/cross RSI SMA with SMA rising. Entry when close ≈ low1_price (0.5% tol). Exit when RSI touches 70 again.';
      const confidenceScore = Number.isFinite(Number(s.confidenceScore))
        ? Number(s.confidenceScore)
        : 65;
      const confidenceLabel = typeof s.confidenceLabel === 'string' && s.confidenceLabel.trim()
        ? s.confidenceLabel.trim()
        : null;
      rows.push({
        instrument: symbol,
        tradingsymbol: tradingsymbol || symbol,
        signal_type: 'BUY',
        confidence: confidenceScore / 100,
        explanation,
        entryPrice: s.entryPrice,
        entryTime,
        confidenceScore,
        confidenceLabel,
        structure: { entryIndex: s.entryIndex },
        rsi: rsiValue,
        currentPrice,
        createdAt: now,
        mode,
      });
    }
  } else {
    rows.push({
      instrument: symbol,
      tradingsymbol: tradingsymbol || symbol,
      signal_type: 'HOLD',
      confidence: null,
      explanation: lastResult?.explanation || 'Insufficient data or structure not found.',
      entryPrice: null,
      entryTime: null,
      confidenceScore: null,
      confidenceLabel: null,
      structure: null,
      rsi: rsiValue,
      currentPrice,
      createdAt: now,
      mode,
    });
  }

  return rows;
}

/** 80% Setup: one row per symbol (BUY if last bar is setup, else HOLD). Returns array of one row per setup for BUY. */
async function evaluateEightyPercentForSymbol(symbol, tradingsymbol, timeframe) {
  const candles = await getCandlesForSignal(symbol, timeframe, 500);
  if (candles.length < 30) return null;
  const ohlcv = candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
  }));
  const { setups, lastResult } = evaluateEightyPercentAllSetups(ohlcv);
  const indicators = computeIndicators(ohlcv);
  const rsiValue = indicators?.rsi != null && Number.isFinite(indicators.rsi) ? Math.round(indicators.rsi * 100) / 100 : null;
  const now = new Date();
  const rows = [];

  if (setups.length > 0) {
    for (const s of setups) {
      const entryTime = candles[s.entryIndex]?.time ?? null;
      const explanation = `80% Setup: RSI dipped below ${EIGHTY_PERCENT_RSI_PRECONDITION}, rose above ${EIGHTY_PERCENT_RSI_ARM}, then crossed down through RSI MA; entry is first dip-below-${EIGHTY_PERCENT_RSI_PRECONDITION} close ${Number(s.entryPrice).toFixed(2)}.`;
      const psl = s.previousSwingLow ?? s.entryPrice;
      rows.push({
        instrument: symbol,
        tradingsymbol: tradingsymbol || symbol,
        signal_type: 'BUY',
        confidence: 0.8,
        explanation,
        entryPrice: s.entryPrice,
        firstDipBelow40Close: s.firstDipBelow40Close ?? s.entryPrice ?? null,
        previousSwingLow: psl,
        entryTime,
        confidenceScore: 80,
        confidenceLabel: '80% target',
        rsi: rsiValue,
        createdAt: now,
      });
    }
  } else {
    rows.push({
      instrument: symbol,
      tradingsymbol: tradingsymbol || symbol,
      signal_type: 'HOLD',
      confidence: null,
      explanation: lastResult?.explanation || 'Insufficient data or no setup.',
      entryPrice: null,
      firstDipBelow40Close: null,
      entryTime: null,
      confidenceScore: null,
      confidenceLabel: null,
      rsi: rsiValue,
      createdAt: now,
    });
  }
  return rows;
}

/** Optional `profitTargetPct` / `rsiRemainderExit` query params — same interpretation as copy backtest. */
function parseRsiMaCopyExitQuery(query) {
  const out = {};
  if (query?.profitTargetPct != null && String(query.profitTargetPct).trim() !== '') {
    const v = Number(query.profitTargetPct);
    if (Number.isFinite(v) && v > 0) out.profitTargetPct = v;
  }
  if (query?.rsiRemainderExit != null && String(query.rsiRemainderExit).trim() !== '') {
    const v = Number(query.rsiRemainderExit);
    if (Number.isFinite(v)) out.rsiRemainderExit = v;
  }
  if (query?.partialTpFraction != null && String(query.partialTpFraction).trim() !== '') {
    const parsed = parseRsiMaCopyPartialTpFraction(query.partialTpFraction);
    if ('value' in parsed && parsed.value != null) out.partialTpFraction = parsed.value;
  }
  return out;
}

/** @returns {{ evalOpts: object, error?: string }} */
function parseRsiMaCopyPriceRangeQuery(query) {
  const pf = parseRsiBacktestPriceFilter(query?.minStockPrice, query?.maxStockPrice);
  if ('error' in pf) return { evalOpts: {}, error: pf.error };
  const evalOpts = {};
  if (pf.minPrice != null) evalOpts.minStockPrice = pf.minPrice;
  if (pf.maxPrice != null) evalOpts.maxStockPrice = pf.maxPrice;
  return { evalOpts };
}

function attachRsiMaCopyTradeLevels(row, entryPrice, exitOpts) {
  if (!row || row.signal_type !== 'BUY' || entryPrice == null || !Number.isFinite(Number(entryPrice))) return row;
  const levels = planRsiMaCopyTradeLevels(entryPrice, exitOpts);
  if (!levels) return row;
  return { ...row, ...levels };
}

/** RSI↓MA Setup (copy): same row shape as primary; uses `rsiMaSetupCopy.js` for independent tuning. */
async function evaluateRsiMaSetupCopyForSymbol(
  symbol,
  tradingsymbol,
  timeframe,
  exitOpts = {},
  evalOpts = {},
  dateRange = null,
) {
  const fetchOpts =
    dateRange?.candleOpts && Object.keys(dateRange.candleOpts).length > 0 ? dateRange.candleOpts : undefined;
  const candles = await getCandlesForSignal(symbol, timeframe, 500, fetchOpts);
  if (candles.length < 30) return null;
  const ohlcv = candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
  }));
  const { setups, lastResult } = evaluateRsiMaSetupCopyAllSetups(ohlcv, evalOpts);
  const indicators = computeIndicators(ohlcv);
  const rsiValue = indicators?.rsi != null && Number.isFinite(indicators.rsi) ? Math.round(indicators.rsi * 100) / 100 : null;
  const now = new Date();
  const rows = [];
  const { minStockPrice: effMinP, maxStockPrice: effMaxP } = resolveRsiMaCopyEvalOpts(evalOpts);
  const priceFilterParts = [];
  if (evalOpts.minStockPrice != null) priceFilterParts.push(`min ₹${effMinP}`);
  if (effMaxP != null) priceFilterParts.push(`max ₹${effMaxP}`);
  const priceFilterNote = priceFilterParts.length ? ` Price filter (cross & entry close): ${priceFilterParts.join(', ')}.` : '';

  if (setups.length > 0) {
    for (const s of setups) {
      const entryTime = candles[s.entryIndex]?.time ?? null;
      const explanation = `RSI↓MA Setup (copy): RSI dipped below ${RSI_MA_COPY_RSI_PRECONDITION}, rose above ${RSI_MA_COPY_RSI_ARM}, then crossed down through RSI MA; entry is lowest low while RSI below ${RSI_MA_COPY_RSI_PRECONDITION} ${Number(s.entryPrice).toFixed(2)}.${priceFilterNote}`;
      const psl = s.previousSwingLow ?? s.entryPrice;
      rows.push(
        attachRsiMaCopyTradeLevels(
          {
            instrument: symbol,
            tradingsymbol: tradingsymbol || symbol,
            signal_type: 'BUY',
            confidence: 0.8,
            explanation,
            entryPrice: s.entryPrice,
            firstDipBelow40Close: s.firstDipBelow40Close ?? s.entryPrice ?? null,
            previousSwingLow: psl,
            entryTime,
            confidenceScore: 80,
            confidenceLabel: 'RSI↓MA copy',
            rsi: rsiValue,
            createdAt: now,
          },
          s.entryPrice,
          exitOpts,
        ),
      );
    }
  } else {
    rows.push({
      instrument: symbol,
      tradingsymbol: tradingsymbol || symbol,
      signal_type: 'HOLD',
      confidence: null,
      explanation: lastResult?.explanation || 'Insufficient data or no setup.',
      entryPrice: null,
      firstDipBelow40Close: null,
      entryTime: null,
      confidenceScore: null,
      confidenceLabel: null,
      rsi: rsiValue,
      createdAt: now,
    });
  }

  if (dateRange && (dateRange.filterFrom || dateRange.filterTo)) {
    const buys = rows.filter(
      (r) =>
        r.signal_type === 'BUY' &&
        signalEntryInRsiMaCopyDateRange(r.entryTime, dateRange.filterFrom, dateRange.filterTo),
    );
    if (buys.length > 0) return buys;
    return [
      {
        instrument: symbol,
        tradingsymbol: tradingsymbol || symbol,
        signal_type: 'HOLD',
        confidence: null,
        explanation: 'No RSI↓MA Setup (copy) BUY in the selected date range.',
        entryPrice: null,
        firstDipBelow40Close: null,
        entryTime: null,
        confidenceScore: null,
        confidenceLabel: null,
        rsi: rsiValue,
        createdAt: now,
      },
    ];
  }
  return rows;
}

/** BUY on latest daily bar only (same as `evaluate()` in rsiMaSetupCopy.js), for scan-all live list. */
async function evaluateRsiMaSetupCopyLiveDailyOnly(symbol, tradingsymbol, exitOpts = {}, evalOpts = {}, dateRange = null) {
  const fetchOpts =
    dateRange?.candleOpts && Object.keys(dateRange.candleOpts).length > 0 ? dateRange.candleOpts : undefined;
  const candles = await getCandlesForSignal(symbol, 'day', 500, fetchOpts);
  if (candles.length < 30) return null;
  if (dateRange && (dateRange.filterFrom || dateRange.filterTo)) {
    const lastT = candles[candles.length - 1]?.time;
    const ms = lastT instanceof Date ? lastT.getTime() : new Date(lastT).getTime();
    if (!Number.isNaN(ms)) {
      if (dateRange.filterFrom && ms < dateRange.filterFrom.getTime()) return null;
      if (dateRange.filterTo && ms > dateRange.filterTo.getTime()) return null;
    }
  }
  const ohlcv = candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume ?? 0,
  }));
  const result = evaluateRsiMaSetupCopyLastBar(ohlcv, evalOpts);
  if (result.signal !== 'BUY') return null;
  const indicators = computeIndicators(ohlcv);
  const rsiValue =
    indicators?.rsi != null && Number.isFinite(indicators.rsi) ? Math.round(indicators.rsi * 100) / 100 : null;
  const i = result.entryIndex != null ? result.entryIndex : ohlcv.length - 1;
  const entryTime = candles[i]?.time ?? null;
  const entry = result.entryPrice;
  const now = new Date();
  return attachRsiMaCopyTradeLevels(
    {
      instrument: symbol,
      tradingsymbol: tradingsymbol || symbol,
      signal_type: 'BUY',
      confidence: 0.8,
      explanation: result.explanation,
      entryPrice: entry,
      firstDipBelow40Close: result.firstDipBelow40Close ?? entry ?? null,
      previousSwingLow: result.previousSwingLow ?? entry ?? null,
      entryTime,
      confidenceScore: 80,
      confidenceLabel: 'RSI↓MA copy · live daily',
      liveDailyBar: true,
      rsi: rsiValue,
      createdAt: now,
    },
    entry,
    exitOpts,
  );
}

import { trainModel } from '../services/PatternService.js';
import { getAlertService } from '../services/AlertService.js';
import { logger } from '../logger.js';

const router = Router();

// Initialize alert service on first use
getAlertService();

/**
 * GET /api/signals
 * List latest signals. Query: instrument, timeframe, limit (default 50).
 */
router.get('/', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const instrument = (req.query.instrument || '').trim();
    const timeframe = (req.query.timeframe || '').trim();
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const filter = {};
    if (instrument) filter.instrument = instrument;
    if (timeframe) filter.timeframe = timeframe;
    const list = await Signal.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ signals: list });
  } catch (err) {
    logger.error('Signals list failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'List failed' });
  }
});

/**
 * GET /api/signals/combined
 * One row per instrument: latest 1D and 1H signals combined.
 * Combined = BUY only if both 1D and 1H are BUY; SELL only if both are SELL; else HOLD.
 */
router.get('/combined', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const limit = Math.min(2000, Math.max(50, parseInt(req.query.limit, 10) || 200));
    const instrumentFilter = (req.query.instrument || '').trim();
    const raw = await Signal.find({
      timeframe: { $in: ['day', '60minute'] },
      ...(instrumentFilter ? { $or: [{ instrument: instrumentFilter }, { tradingsymbol: new RegExp(`^${instrumentFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }] } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(limit * 2)
      .lean();

    const byInstrument = {};
    for (const s of raw) {
      const key = String(s.instrument || s.tradingsymbol || '').trim();
      if (!key) continue;
      if (!byInstrument[key]) {
        byInstrument[key] = { instrument: s.instrument, tradingsymbol: s.tradingsymbol || s.instrument, day: null, hour: null };
      }
      const slot = s.timeframe === 'day' ? 'day' : s.timeframe === '60minute' ? 'hour' : null;
      if (slot && byInstrument[key][slot] === null) {
        byInstrument[key][slot] = {
          signal_type: s.signal_type,
          confidence: s.confidence,
          createdAt: s.createdAt,
          explanation: s.explanation ?? '',
        };
      }
    }

    const combined = [];
    for (const [key, row] of Object.entries(byInstrument)) {
      const daySig = row.day?.signal_type;
      const hourSig = row.hour?.signal_type;
      let signal_type = 'HOLD';
      if (daySig === 'BUY' && hourSig === 'BUY') signal_type = 'BUY';
      else if (daySig === 'SELL' && hourSig === 'SELL') signal_type = 'SELL';

      const dayConf = row.day?.confidence;
      const hourConf = row.hour?.confidence;
      const dayExplanation = (row.day?.explanation && String(row.day.explanation).trim()) ? String(row.day.explanation).trim() : 'No explanation available.';
      const hourExplanation = (row.hour?.explanation && String(row.hour.explanation).trim()) ? String(row.hour.explanation).trim() : 'No explanation available.';
      const latestAt = [row.day?.createdAt, row.hour?.createdAt].filter(Boolean).sort().pop();

      combined.push({
        instrument: row.instrument || key,
        tradingsymbol: row.tradingsymbol || key,
        signal_type,
        daySignal: daySig || null,
        hourSignal: hourSig || null,
        dayConfidence: dayConf ?? null,
        hourConfidence: hourConf ?? null,
        dayExplanation,
        hourExplanation,
        createdAt: latestAt,
      });
    }
    combined.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json({ signals: combined });
  } catch (err) {
    logger.error('Signals combined failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Combined failed' });
  }
});

/**
 * GET /api/signals/indicators
 * Get indicators for symbol + timeframe (from stored candles). Query: symbol, timeframe, limit (default 500).
 */
router.get('/indicators', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const symbol = (req.query.symbol || req.query.instrument || '').trim();
    const timeframe = (req.query.timeframe || 'day').trim();
    const limit = Math.min(500, Math.max(50, parseInt(req.query.limit, 10) || 500));
    if (!symbol) {
      return res.status(400).json({ error: 'symbol or instrument required' });
    }
    const candles = await getCandlesForSignal(symbol, timeframe, limit);
    if (candles.length < 20) {
      return res.json({ indicators: null, message: 'Insufficient candles', count: candles.length });
    }
    const ohlcv = candles.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    const indicators = computeIndicators(ohlcv);
    res.json({ indicators, count: candles.length });
  } catch (err) {
    logger.error('Indicators failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Indicators failed' });
  }
});

/**
 * GET /api/signals/rsi-setup
 * Evaluate RSI Setup strategy for symbol+timeframe. Query: symbol, timeframe (default day).
 * Returns full signal object: entry, stop, target, confidence, structure.
 */
router.get('/rsi-setup', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const symbol = (req.query.symbol || req.query.instrument || '').trim();
    const timeframe = (req.query.timeframe || 'day').trim();
    const mode = parseRsiSetupMode(req.query.mode);
    const th = parseRsiSetupThresholds(req.query);
    if ('error' in th) return res.status(400).json({ error: th.error });
    const { thresholds } = th;
    if (!symbol) {
      return res.status(400).json({ error: 'symbol or instrument required' });
    }
    const candles = await getCandlesForSignal(symbol, timeframe, 500);
    if (candles.length < 50) {
      return res.json({
        signal: 'HOLD',
        signal_type: 'HOLD',
        message: `Insufficient candles (${candles.length}, need ≥50)`,
        count: candles.length,
      });
    }
    const ohlcv = candles.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0,
    }));

    const result = evaluateRsiSetup(ohlcv, {}, { mode, thresholds });
    const last = ohlcv[ohlcv.length - 1];
    const currentPrice = last?.close != null && Number.isFinite(Number(last.close)) ? Number(last.close) : null;
    const out = {
      ...result,
      signal_type: result.signal === 'BUY' ? 'BUY' : 'HOLD',
      count: candles.length,
      currentPrice,
      mode,
      thresholds,
    };
    res.json(out);
  } catch (err) {
    logger.error('RSI Setup failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'RSI Setup failed' });
  }
});

/**
 * GET /api/signals/rsi-setup/combined
 * One row per instrument: RSI Setup strategy for 1D only.
 */
router.get('/rsi-setup/combined', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const mode = parseRsiSetupMode(req.query.mode);
    const th = parseRsiSetupThresholds(req.query);
    if ('error' in th) return res.status(400).json({ error: th.error });
    const { thresholds } = th;
    const symbols = await getSymbolsWithStoredCandles();
    const reqLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(reqLimit) && reqLimit > 0 ? Math.min(5000, reqLimit) : symbols.length;
    const combined = [];
    for (let i = 0; i < Math.min(symbols.length, limit); i++) {
      const { symbol: sym, tradingsymbol: ts } = symbols[i];
      const inst = sym || ts;
      if (!inst) continue;
      try {
        const rows = await evaluateRsiSetupForSymbol(sym, ts, 'day', mode, thresholds);
        if (!rows || rows.length === 0) continue;
        combined.push(...rows);
      } catch (err) {
        logger.warn('RSI Setup combined skip', { symbol: inst, error: err?.message });
      }
    }
    combined.sort((a, b) => {
      const ord = { BUY: 0, HOLD: 1, SELL: 2 };
      return (ord[a.signal_type] ?? 1) - (ord[b.signal_type] ?? 1);
    });
    res.json({ signals: combined, checkedCount: Math.min(symbols.length, limit), mode, thresholds });
  } catch (err) {
    logger.error('RSI Setup combined failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'RSI Setup combined failed' });
  }
});

/**
 * GET /api/signals/eighty-percent/combined
 * 80% Setup: RSI < 40 -> RSI > 55 -> cross down RSI MA; entry at first < 40 close. 1D only.
 */
router.get('/eighty-percent/combined', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const symbols = await getSymbolsWithStoredCandles();
    const reqLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(reqLimit) && reqLimit > 0 ? Math.min(5000, reqLimit) : symbols.length;
    const combined = [];
    for (let i = 0; i < Math.min(symbols.length, limit); i++) {
      const { symbol: sym, tradingsymbol: ts } = symbols[i];
      if (!sym && !ts) continue;
      try {
        const rows = await evaluateEightyPercentForSymbol(sym, ts, 'day');
        if (!rows || rows.length === 0) continue;
        combined.push(...rows);
      } catch (err) {
        logger.warn('80% Setup combined skip', { symbol: sym || ts, error: err?.message });
      }
    }
    combined.sort((a, b) => (a.signal_type === 'BUY' ? 0 : 1) - (b.signal_type === 'BUY' ? 0 : 1));
    res.json({ signals: combined, checkedCount: Math.min(symbols.length, limit) });
  } catch (err) {
    logger.error('80% Setup combined failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? '80% Setup combined failed' });
  }
});

/**
 * POST /api/signals/eighty-percent/backtest
 * Body: { symbol, maxHoldingDays?, series?: 'day'|'month' }. Monthly = aggregate stored daily into UTC monthly bars.
 */
router.post('/eighty-percent/backtest', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const symbol = (req.body?.symbol ?? req.query?.symbol ?? '').trim();
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const mh = parseRsiBacktestMaxHoldingDays(req.body?.maxHoldingDays ?? req.query?.maxHoldingDays);
    if ('error' in mh) return res.status(400).json({ error: mh.error });
    const maxHoldingDays = mh.value;
    const series = req.body?.series ?? req.query?.series;
    const loaded = await loadOhlcvRsiMaBacktest(symbol, series);
    if (!loaded.ok) return res.status(loaded.status).json(loaded.body);
    const result = runEightyPercentBacktest(loaded.ohlcv, { maxHoldingDays });
    const monthlyBreakdown = aggregateTradesByExitMonth(result.trades, loaded.ohlcv);
    const payload = {
      symbol,
      barUnit: loaded.barUnit,
      dailyBarsUsed: loaded.dailyBarsUsed,
      monthlyBars: loaded.monthlyBars,
      monthlyBreakdown,
      ...result,
    };
    void persistBacktestRun({
      route: 'POST /api/signals/eighty-percent/backtest',
      method: 'POST',
      params: sanitizeBacktestRequest(req),
      response: payload,
    });
    res.json(payload);
  } catch (err) {
    logger.error('80% Setup backtest failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? '80% Setup backtest failed' });
  }
});

/**
 * GET /api/signals/eighty-percent/backtest/combined?limit=&maxHoldingDays=&series=day|month
 * Run 80% Setup backtest on all symbols with stored day candles (or monthly aggregate).
 * Each `results[]` row omits `trades` (use POST /eighty-percent/backtest for trade lists).
 */
router.get('/eighty-percent/backtest/combined', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const mh = parseRsiBacktestMaxHoldingDays(req.query.maxHoldingDays);
    if ('error' in mh) return res.status(400).json({ error: mh.error });
    const maxHoldingDays = mh.value;
    const series = req.query.series;
    const barUnit = normalizeBacktestSeries(series) === 'month' ? 'month' : 'day';
    const symbols = await getSymbolsWithStoredCandles();
    const reqLimit = parseInt(req.query.limit, 10);
    const maxSymbols = Number.isFinite(reqLimit) && reqLimit > 0 ? Math.min(5000, reqLimit) : symbols.length;
    const toRun = symbols.slice(0, maxSymbols);
    const results = [];
    let skippedInsufficientCandles = 0;
    let totalInvestedAmount = 0;
    let totalPnl = 0;
    for (const { symbol: sym, tradingsymbol: ts } of toRun) {
      const inst = ts || sym;
      try {
        const loaded = await loadOhlcvRsiMaBacktest(sym, series);
        if (!loaded.ok) {
          skippedInsufficientCandles += 1;
          continue;
        }
        const result = runEightyPercentBacktest(loaded.ohlcv, { maxHoldingDays });
        const monthlyBreakdown = aggregateTradesByExitMonth(result.trades, loaded.ohlcv);
        const sums = sumTradesInvestedAndPnl(result.trades);
        totalInvestedAmount += sums.totalInvestedAmount;
        totalPnl += sums.totalPnl;
        results.push(toCombinedBacktestRow(result, monthlyBreakdown, inst, ts || sym));
      } catch (err) {
        logger.warn('80% Setup backtest skip', { symbol: inst, error: err?.message });
      }
    }
    const totalTrades = results.reduce((s, r) => s + (r.tradesCount || 0), 0);
    const wins = results.reduce((s, r) => s + (r.tradesCount ? Math.round(r.winRate * r.tradesCount) : 0), 0);
    const totalPnlPercent = totalInvestedAmount > 0 ? totalPnl / totalInvestedAmount : 0;
    const payload = {
      summary: {
        totalTrades,
        winRate: totalTrades > 0 ? wins / totalTrades : 0,
        totalInvestedAmount,
        totalPnl,
        totalPnlPercent,
        minStockPrice: EIGHTY_PERCENT_MIN_PRICE,
        barUnit,
        symbolsProcessed: results.length,
        symbolsSkippedInsufficientCandles: skippedInsufficientCandles,
        symbolsChecked: toRun.length,
      },
      results,
      maxHoldingDays: maxHoldingDays ?? null,
      barUnit,
    };
    void persistBacktestRun({
      route: 'GET /api/signals/eighty-percent/backtest/combined',
      method: 'GET',
      params: sanitizeBacktestRequest(req),
      response: payload,
    });
    res.json(payload);
  } catch (err) {
    logger.error('80% Setup backtest combined failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? '80% Setup backtest combined failed' });
  }
});

/**
 * GET /api/signals/rsi-ma-setup-copy/combined
 * Copy of RSI↓MA setup; same rules as eighty-percent. 1D only.
 */
router.get('/rsi-ma-setup-copy/combined', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const parsedRange = parseRsiMaCopyDateRangePayload(req.query, {});
    if (parsedRange.error) return res.status(400).json({ error: parsedRange.error });
    const dateRange = parsedRange.range;

    const symbols = await getSymbolsWithStoredCandles();
    const reqLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(reqLimit) && reqLimit > 0 ? Math.min(5000, reqLimit) : symbols.length;
    const liveOnly =
      req.query.liveOnly === 'true' || req.query.liveOnly === '1' || req.query.liveOnly === 1;
    const exitOpts = parseRsiMaCopyExitQuery(req.query);
    const { evalOpts, error: priceErr } = parseRsiMaCopyPriceRangeQuery(req.query);
    if (priceErr) return res.status(400).json({ error: priceErr });
    const combined = [];
    for (let i = 0; i < Math.min(symbols.length, limit); i++) {
      const { symbol: sym, tradingsymbol: ts } = symbols[i];
      if (!sym && !ts) continue;
      try {
        if (liveOnly) {
          const row = await evaluateRsiMaSetupCopyLiveDailyOnly(sym, ts, exitOpts, evalOpts, dateRange);
          if (row) combined.push(row);
        } else {
          const rows = await evaluateRsiMaSetupCopyForSymbol(sym, ts, 'day', exitOpts, evalOpts, dateRange);
          if (!rows || rows.length === 0) continue;
          combined.push(...rows);
        }
      } catch (err) {
        logger.warn('RSI↓MA Setup copy combined skip', { symbol: sym || ts, error: err?.message });
      }
    }
    combined.sort((a, b) => (a.signal_type === 'BUY' ? 0 : 1) - (b.signal_type === 'BUY' ? 0 : 1));
    const checkedCount = Math.min(symbols.length, limit);
    const rangeMeta =
      dateRange &&
      (dateRange.filterFrom || dateRange.filterTo || req.query.fromDate || req.query.toDate)
        ? {
            fromDate: dateRange.filterFrom ? dateRange.filterFrom.toISOString().slice(0, 10) : null,
            toDate: dateRange.filterTo ? dateRange.filterTo.toISOString().slice(0, 10) : null,
          }
        : undefined;
    if (liveOnly) {
      res.json({
        signals: combined,
        checkedCount,
        liveOnly: true,
        buyCount: combined.length,
        ...(rangeMeta ? { dateRange: rangeMeta } : {}),
      });
    } else {
      res.json({ signals: combined, checkedCount, ...(rangeMeta ? { dateRange: rangeMeta } : {}) });
    }
  } catch (err) {
    logger.error('RSI↓MA Setup copy combined failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'RSI↓MA Setup copy combined failed' });
  }
});

/**
 * POST /api/signals/rsi-ma-setup-copy/backtest
 */
router.post('/rsi-ma-setup-copy/backtest', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const symbol = (req.body?.symbol ?? req.query?.symbol ?? '').trim();
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const mh = parseRsiBacktestMaxHoldingDays(req.body?.maxHoldingDays ?? req.query?.maxHoldingDays);
    if ('error' in mh) return res.status(400).json({ error: mh.error });
    const maxHoldingDays = mh.value;
    const series = req.body?.series ?? req.query?.series;
    const ptp = parseRsiMaCopyProfitTargetPct(req.body?.profitTargetPct ?? req.query?.profitTargetPct);
    if ('error' in ptp) return res.status(400).json({ error: ptp.error });
    const rsiRem = parseRsiMaCopyRsiRemainderExit(req.body?.rsiRemainderExit ?? req.query?.rsiRemainderExit);
    if ('error' in rsiRem) return res.status(400).json({ error: rsiRem.error });
    const pFrac = parseRsiMaCopyPartialTpFraction(req.body?.partialTpFraction ?? req.query?.partialTpFraction);
    if ('error' in pFrac) return res.status(400).json({ error: pFrac.error });
    const pf = parseRsiBacktestPriceFilter(
      req.body?.minStockPrice ?? req.query?.minStockPrice,
      req.body?.maxStockPrice ?? req.query?.maxStockPrice,
    );
    if ('error' in pf) return res.status(400).json({ error: pf.error });
    const parsedRange = parseRsiMaCopyDateRangePayload(req.query ?? {}, req.body ?? {});
    if (parsedRange.error) return res.status(400).json({ error: parsedRange.error });
    const copyBtOpts = { maxHoldingDays };
    if (ptp.value != null) copyBtOpts.profitTargetPct = ptp.value;
    if (rsiRem.value != null) copyBtOpts.rsiRemainderExit = rsiRem.value;
    if (pFrac.value != null) copyBtOpts.partialTpFraction = pFrac.value;
    if (pf.minPrice != null) copyBtOpts.minStockPrice = pf.minPrice;
    if (pf.maxPrice != null) copyBtOpts.maxStockPrice = pf.maxPrice;
    const loaded = await loadOhlcvRsiMaBacktest(symbol, series, parsedRange.range);
    if (!loaded.ok) return res.status(loaded.status).json(loaded.body);
    const result = runRsiMaSetupCopyBacktest(loaded.ohlcv, copyBtOpts);
    const { result: adjResult, monthlyBreakdown } = applyRsiMaCopyDateRangeToBacktestResult(
      result,
      loaded.ohlcv,
      parsedRange.range?.filterFrom ?? null,
      parsedRange.range?.filterTo ?? null,
    );
    const rangeMeta =
      parsedRange.range &&
      (parsedRange.range.filterFrom || parsedRange.range.filterTo)
        ? {
            fromDate: parsedRange.range.filterFrom
              ? parsedRange.range.filterFrom.toISOString().slice(0, 10)
              : null,
            toDate: parsedRange.range.filterTo
              ? parsedRange.range.filterTo.toISOString().slice(0, 10)
              : null,
          }
        : undefined;
    const payload = {
      symbol,
      barUnit: loaded.barUnit,
      dailyBarsUsed: loaded.dailyBarsUsed,
      monthlyBars: loaded.monthlyBars,
      monthlyBreakdown,
      ...adjResult,
      ...(rangeMeta ? { dateRange: rangeMeta } : {}),
    };
    void persistBacktestRun({
      route: 'POST /api/signals/rsi-ma-setup-copy/backtest',
      method: 'POST',
      params: sanitizeBacktestRequest(req),
      response: payload,
    });
    res.json(payload);
  } catch (err) {
    logger.error('RSI↓MA Setup copy backtest failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'RSI↓MA Setup copy backtest failed' });
  }
});

/**
 * GET /api/signals/rsi-ma-setup-copy/backtest/combined
 * Each `results[]` row omits `trades` (use POST /rsi-ma-setup-copy/backtest for trade lists).
 */
router.get('/rsi-ma-setup-copy/backtest/combined', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const mh = parseRsiBacktestMaxHoldingDays(req.query.maxHoldingDays);
    if ('error' in mh) return res.status(400).json({ error: mh.error });
    const maxHoldingDays = mh.value;
    const series = req.query.series;
    const ptp = parseRsiMaCopyProfitTargetPct(req.query.profitTargetPct);
    if ('error' in ptp) return res.status(400).json({ error: ptp.error });
    const rsiRem = parseRsiMaCopyRsiRemainderExit(req.query.rsiRemainderExit);
    if ('error' in rsiRem) return res.status(400).json({ error: rsiRem.error });
    const pFrac = parseRsiMaCopyPartialTpFraction(req.query.partialTpFraction);
    if ('error' in pFrac) return res.status(400).json({ error: pFrac.error });
    const pf = parseRsiBacktestPriceFilter(req.query.minStockPrice, req.query.maxStockPrice);
    if ('error' in pf) return res.status(400).json({ error: pf.error });
    const parsedRange = parseRsiMaCopyDateRangePayload(req.query, {});
    if (parsedRange.error) return res.status(400).json({ error: parsedRange.error });
    const copyBtOpts = { maxHoldingDays };
    if (ptp.value != null) copyBtOpts.profitTargetPct = ptp.value;
    if (rsiRem.value != null) copyBtOpts.rsiRemainderExit = rsiRem.value;
    if (pFrac.value != null) copyBtOpts.partialTpFraction = pFrac.value;
    if (pf.minPrice != null) copyBtOpts.minStockPrice = pf.minPrice;
    if (pf.maxPrice != null) copyBtOpts.maxStockPrice = pf.maxPrice;
    const barUnit = normalizeBacktestSeries(series) === 'month' ? 'month' : 'day';
    const symbols = await getSymbolsWithStoredCandles();
    const reqLimit = parseInt(req.query.limit, 10);
    const maxSymbols = Number.isFinite(reqLimit) && reqLimit > 0 ? Math.min(5000, reqLimit) : symbols.length;
    const toRun = symbols.slice(0, maxSymbols);
    const results = [];
    let skippedInsufficientCandles = 0;
    let totalInvestedAmount = 0;
    let totalPnl = 0;
    for (const { symbol: sym, tradingsymbol: ts } of toRun) {
      const inst = ts || sym;
      try {
        const loaded = await loadOhlcvRsiMaBacktest(sym, series, parsedRange.range);
        if (!loaded.ok) {
          skippedInsufficientCandles += 1;
          continue;
        }
        const result = runRsiMaSetupCopyBacktest(loaded.ohlcv, copyBtOpts);
        const { result: adjResult, monthlyBreakdown } = applyRsiMaCopyDateRangeToBacktestResult(
          result,
          loaded.ohlcv,
          parsedRange.range?.filterFrom ?? null,
          parsedRange.range?.filterTo ?? null,
        );
        const sums = sumTradesInvestedAndPnl(adjResult.trades);
        totalInvestedAmount += sums.totalInvestedAmount;
        totalPnl += sums.totalPnl;
        results.push(toCombinedBacktestRow(adjResult, monthlyBreakdown, inst, ts || sym));
      } catch (err) {
        logger.warn('RSI↓MA Setup copy backtest skip', { symbol: inst, error: err?.message });
      }
    }
    const totalTrades = results.reduce((s, r) => s + (r.tradesCount || 0), 0);
    const wins = results.reduce((s, r) => s + (r.tradesCount ? Math.round(r.winRate * r.tradesCount) : 0), 0);
    const totalPnlPercent = totalInvestedAmount > 0 ? totalPnl / totalInvestedAmount : 0;
    const payload = {
      summary: {
        totalTrades,
        winRate: totalTrades > 0 ? wins / totalTrades : 0,
        totalInvestedAmount,
        totalPnl,
        totalPnlPercent,
        minStockPrice: copyBtOpts.minStockPrice ?? RSI_MA_COPY_MIN_PRICE,
        maxStockPrice: copyBtOpts.maxStockPrice ?? null,
        barUnit,
        symbolsProcessed: results.length,
        symbolsSkippedInsufficientCandles: skippedInsufficientCandles,
        symbolsChecked: toRun.length,
      },
      results,
      maxHoldingDays: maxHoldingDays ?? null,
      barUnit,
      profitTargetPct: ptp.value ?? RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PCT,
      rsiRemainderExit: rsiRem.value ?? RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT,
      partialTpFraction: pFrac.value ?? RSI_MA_COPY_DEFAULT_PARTIAL_TP_FRACTION,
      minStockPrice: pf.minPrice ?? RSI_MA_COPY_MIN_PRICE,
      maxStockPrice: pf.maxPrice ?? null,
      ...(parsedRange.range && (parsedRange.range.filterFrom || parsedRange.range.filterTo)
        ? {
            dateRange: {
              fromDate: parsedRange.range.filterFrom
                ? parsedRange.range.filterFrom.toISOString().slice(0, 10)
                : null,
              toDate: parsedRange.range.filterTo
                ? parsedRange.range.filterTo.toISOString().slice(0, 10)
                : null,
            },
          }
        : {}),
    };
    void persistBacktestRun({
      route: 'GET /api/signals/rsi-ma-setup-copy/backtest/combined',
      method: 'GET',
      params: sanitizeBacktestRequest(req),
      response: payload,
    });
    res.json(payload);
  } catch (err) {
    logger.error('RSI↓MA Setup copy backtest combined failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'RSI↓MA Setup copy backtest combined failed' });
  }
});

/**
 * GET /api/signals/ema-crossover/combined
 * One row per instrument: EMA 10/20 crossover (1H). BUY = cross up, SELL = cross down.
 */
router.get('/ema-crossover/combined', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const symbols = await getSymbolsWithStoredCandles();
    const reqLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(reqLimit) && reqLimit > 0 ? Math.min(5000, reqLimit) : symbols.length;
    const combined = [];
    const now = new Date();
    for (let i = 0; i < Math.min(symbols.length, limit); i++) {
      const { symbol: sym, tradingsymbol: ts } = symbols[i];
      const inst = sym || ts;
      if (!inst) continue;
      try {
        const candles = await getCandlesForSignal(sym, '60minute', 500);
        if (candles.length < 51) continue;
        const closes = candles.map((c) => c.close);
        const result = evaluateEmaCrossover(closes);
        combined.push({
          instrument: sym,
          tradingsymbol: ts || sym,
          signal_type: result.signal,
          explanation: result.explanation || '',
          entryPrice: result.entryPrice ?? null,
          createdAt: now,
        });
      } catch (err) {
        logger.warn('EMA Crossover combined skip', { symbol: inst, error: err?.message });
      }
    }
    combined.sort((a, b) => {
      const ord = { BUY: 0, HOLD: 1, SELL: 2 };
      return (ord[a.signal_type] ?? 1) - (ord[b.signal_type] ?? 1);
    });

    const EMA_CONFIDENCE = 0.65;
    const toInsert = combined.map((row) => ({
      instrument: row.instrument,
      tradingsymbol: row.tradingsymbol || row.instrument,
      timeframe: '60minute',
      signal_type: row.signal_type || 'HOLD',
      confidence: EMA_CONFIDENCE,
      explanation: row.explanation || 'EMA 10/20 crossover (1H).',
      pattern: { name: '', probability: 0 },
      trend_prediction: '',
      indicators: { ruleSignal: 'EMA_CROSSOVER' },
    }));
    if (toInsert.length > 0) {
      try {
        await Signal.insertMany(toInsert);
        logger.info('EMA Crossover combined: persisted to DB', { count: toInsert.length });
      } catch (persistErr) {
        logger.warn('EMA Crossover persist failed', { error: persistErr?.message });
      }
    }

    res.json({ signals: combined, checkedCount: Math.min(symbols.length, limit) });
  } catch (err) {
    logger.error('EMA Crossover combined failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'EMA Crossover combined failed' });
  }
});

const EMA_BACKTEST_DEFAULT_CAPITAL = 10000;

/**
 * GET /api/signals/ema-crossover/backtest
 * Backtest EMA 10/20 crossover on 1D stored candles.
 * Query: timeframe=day (default), symbol= (optional), limit= (optional), minPrice=, maxPrice=, capital= (default 10000).
 * Price filter uses the latest close; symbol skipped if outside [minPrice, maxPrice]. capital = max amount per backtest.
 */
router.get('/ema-crossover/backtest', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const timeframe = (req.query.timeframe || 'day').trim().toLowerCase();
    if (timeframe !== 'day') {
      return res.status(400).json({ error: 'Only timeframe=day is supported for EMA crossover backtest.' });
    }
    const symbolParam = (req.query.symbol || '').trim();
    const limitParam = parseInt(req.query.limit, 10);
    const capitalParam = parseFloat(req.query.capital ?? req.query.amount);
    const capital = Number.isFinite(capitalParam) && capitalParam > 0 ? Math.min(1000000, capitalParam) : EMA_BACKTEST_DEFAULT_CAPITAL;

    const minPriceParam = parseFloat(req.query.minPrice);
    const maxPriceParam = parseFloat(req.query.maxPrice);
    const minPrice = Number.isFinite(minPriceParam) && minPriceParam > 0 ? minPriceParam : null;
    const maxPrice = Number.isFinite(maxPriceParam) && maxPriceParam > 0 ? maxPriceParam : null;

    const cap = 5000;
    const maxSymbols = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(cap, limitParam) : cap;

    const strategyOptions = { fast: 10, slow: 20, filterSlow: 50 };
    const risk = { capital };
    let symbolsToRun;
    if (symbolParam) {
      symbolsToRun = [{ symbol: symbolParam, tradingsymbol: symbolParam }];
    } else {
      const all = await getSymbolsWithStoredCandles();
      symbolsToRun = all.slice(0, maxSymbols);
    }

    const results = [];
    for (const { symbol: sym, tradingsymbol: ts } of symbolsToRun) {
      const inst = sym || ts;
      if (!inst) continue;
      try {
        const candles = await getCandlesForSignal(inst, 'day', 500);
        if (candles.length < 51) continue;
        const lastClose = candles[candles.length - 1]?.close;
        if (minPrice != null && (lastClose == null || lastClose < minPrice)) continue;
        if (maxPrice != null && (lastClose == null || lastClose > maxPrice)) continue;
        const result = await runBacktest({
          strategyName: 'emaCross',
          symbol: inst,
          timeframe: 'day',
          candles,
          strategyOptions,
          risk,
          exitOnCandleClose: true,
        });
        results.push({
          symbol: inst,
          tradingsymbol: ts || inst,
          ...result,
        });
      } catch (err) {
        logger.warn('EMA Crossover backtest skip', { symbol: inst, error: err?.message });
      }
    }

    results.sort((a, b) => (b.totalPnL ?? 0) - (a.totalPnL ?? 0));
    const summary = {
      timeframe: 'day',
      strategy: 'emaCross',
      options: strategyOptions,
      capital,
      minPrice: minPrice ?? undefined,
      maxPrice: maxPrice ?? undefined,
      totalSymbols: results.length,
      totalTrades: results.reduce((s, r) => s + (r.totalTrades ?? 0), 0),
      totalPnL: results.reduce((s, r) => s + (r.totalPnL ?? 0), 0),
    };
    const payload = { summary, results };
    void persistBacktestRun({
      route: 'GET /api/signals/ema-crossover/backtest',
      method: 'GET',
      params: sanitizeBacktestRequest(req),
      response: payload,
    });
    res.json(payload);
  } catch (err) {
    logger.error('EMA Crossover backtest failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'EMA Crossover backtest failed' });
  }
});

/**
 * POST /api/signals/ema-crossover/persist
 * Persist a single EMA crossover signal (e.g. from live WebSocket). Body: { instrument, tradingsymbol?, signal_type, entryPrice?, explanation }.
 */
router.post('/ema-crossover/persist', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const body = req.body || {};
    const instrument = String(body.instrument ?? '').trim();
    const signal_type = (body.signal_type ?? 'HOLD').toUpperCase();
    if (!instrument) {
      return res.status(400).json({ error: 'instrument required' });
    }
    if (!['BUY', 'SELL', 'HOLD'].includes(signal_type)) {
      return res.status(400).json({ error: 'signal_type must be BUY, SELL, or HOLD' });
    }
    const tradingsymbol = (body.tradingsymbol ?? instrument).trim();
    const explanation = String(body.explanation ?? 'EMA 10/20 crossover (1H live).').trim();
    const doc = {
      instrument,
      tradingsymbol,
      timeframe: '60minute',
      signal_type,
      confidence: 0.65,
      explanation,
      pattern: { name: '', probability: 0 },
      trend_prediction: '',
      indicators: { ruleSignal: 'EMA_CROSSOVER_LIVE' },
    };
    if (body.entryPrice != null && Number.isFinite(Number(body.entryPrice))) {
      doc.explanation = `${explanation} Entry: ${Number(body.entryPrice).toFixed(2)}.`;
    }
    const saved = await Signal.create(doc);
    const plain = saved.toObject ? saved.toObject() : saved;
    logger.info('EMA Crossover persist', { instrument: plain.instrument, signal_type: plain.signal_type });
    res.status(201).json(plain);
  } catch (err) {
    logger.error('EMA Crossover persist failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Persist failed' });
  }
});

/** @param {unknown} raw @returns {{ value: null } | { value: number } | { error: string }} */
function parseRsiBacktestMaxHoldingDays(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 3650) {
    return { error: 'maxHoldingDays must be between 1 and 3650, or omitted' };
  }
  return { value: Math.floor(n) };
}

/** @returns {{ value: null } | { value: number } | { error: string }} */
function parseRsiMaCopyProfitTargetPct(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { error: 'profitTargetPct must be a positive number' };
  const asDecimal = n > 1 ? n / 100 : n;
  if (asDecimal < 0.005 || asDecimal > 5) return { error: 'profitTargetPct out of range (0.5%–500%, or decimal 0.005–5)' };
  return { value: asDecimal };
}

/** @returns {{ value: null } | { value: number } | { error: string }} */
function parseRsiMaCopyRsiRemainderExit(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 5 || n > 95) {
    return { error: 'rsiRemainderExit must be an integer between 5 and 95' };
  }
  return { value: n };
}

/** Fraction of position at first TP: 0.8, 80, 1, or 100 for full exit at TP. */
function parseRsiMaCopyPartialTpFraction(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return { error: 'partialTpFraction must be positive (e.g. 0.8, 80 for 80%, or 1 / 100 for 100%)' };
  }
  const f = n > 1 ? n / 100 : n;
  if (f > 1) return { error: 'partialTpFraction cannot exceed 100% (use 1 or 100)' };
  if (f < 0.01) return { error: 'partialTpFraction must be at least 1% (0.01 or 1)' };
  return { value: f };
}

/** @param {unknown} minRaw @param {unknown} maxRaw @returns {{ minPrice: null, maxPrice: null } | { error: string }} */
function parseRsiBacktestPriceFilter(minRaw, maxRaw) {
  let minPrice = null;
  let maxPrice = null;
  const minStr = minRaw === undefined || minRaw === null ? '' : String(minRaw).trim();
  const maxStr = maxRaw === undefined || maxRaw === null ? '' : String(maxRaw).trim();
  if (minStr !== '') {
    const n = Number(minStr);
    if (!Number.isFinite(n) || n < 0) {
      return { error: 'minPrice must be a non-negative number or omitted' };
    }
    minPrice = n;
  }
  if (maxStr !== '') {
    const n = Number(maxStr);
    if (!Number.isFinite(n) || n < 0) {
      return { error: 'maxPrice must be a non-negative number or omitted' };
    }
    maxPrice = n;
  }
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    return { error: 'minPrice must be ≤ maxPrice' };
  }
  return { minPrice, maxPrice };
}

function pricePassesBacktestFilter(price, minPrice, maxPrice) {
  if (minPrice == null && maxPrice == null) return true;
  if (price == null || !Number.isFinite(Number(price))) return false;
  const p = Number(price);
  if (minPrice != null && p < minPrice) return false;
  if (maxPrice != null && p > maxPrice) return false;
  return true;
}

function parseRsiSetupMode(rawMode) {
  return normalizeRsiSetupMode(rawMode);
}

function parseRsiSetupThresholds(raw) {
  const parseOne = (v) => {
    if (v === undefined || v === null || String(v).trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const low1Min = parseOne(raw?.low1Min);
  const low1Max = parseOne(raw?.low1Max);
  const reboundMin = parseOne(raw?.reboundMin);
  const reboundMax = parseOne(raw?.reboundMax);
  const maTouchTolerance = parseOne(raw?.maTouchTolerance);
  const maTouchAboveSlack = parseOne(raw?.maTouchAboveSlack);
  const vals = { low1Min, low1Max, reboundMin, reboundMax, maTouchTolerance, maTouchAboveSlack };
  for (const [k, v] of Object.entries(vals)) {
    if (Number.isNaN(v)) return { error: `${k} must be a number or omitted` };
  }
  if (low1Min != null && low1Max != null && low1Min > low1Max) return { error: 'low1Min must be ≤ low1Max' };
  if (reboundMin != null && reboundMax != null && reboundMin > reboundMax) return { error: 'reboundMin must be ≤ reboundMax' };
  if (maTouchTolerance != null && (maTouchTolerance < 0 || maTouchTolerance > 30)) {
    return { error: 'maTouchTolerance must be between 0 and 30, or omitted' };
  }
  if (maTouchAboveSlack != null && (maTouchAboveSlack < 0 || maTouchAboveSlack > 30)) {
    return { error: 'maTouchAboveSlack must be between 0 and 30, or omitted' };
  }
  return {
    thresholds: {
      ...(low1Min != null ? { low1Min } : {}),
      ...(low1Max != null ? { low1Max } : {}),
      ...(reboundMin != null ? { reboundMin } : {}),
      ...(reboundMax != null ? { reboundMax } : {}),
      ...(maTouchTolerance != null ? { maTouchTolerance } : {}),
      ...(maTouchAboveSlack != null ? { maTouchAboveSlack } : {}),
    },
  };
}

/**
 * POST /api/signals/rsi-setup/backtest
 * Body: { symbol, maxHoldingDays?, minPrice?, maxPrice? } — filter by last daily close (omit bounds to disable).
 */
router.post('/rsi-setup/backtest', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const mode = parseRsiSetupMode(req.body?.mode ?? req.query?.mode);
    const th = parseRsiSetupThresholds(req.body ?? req.query ?? {});
    if ('error' in th) return res.status(400).json({ error: th.error });
    const { thresholds } = th;
    const symbol = (req.body?.symbol ?? req.query?.symbol ?? '').trim();
    if (!symbol) {
      return res.status(400).json({ error: 'symbol required' });
    }
    const mh = parseRsiBacktestMaxHoldingDays(req.body?.maxHoldingDays);
    if ('error' in mh) {
      return res.status(400).json({ error: mh.error });
    }
    const maxHoldingDays = mh.value;
    const pf = parseRsiBacktestPriceFilter(req.body?.minPrice, req.body?.maxPrice);
    if ('error' in pf) {
      return res.status(400).json({ error: pf.error });
    }
    const { minPrice, maxPrice } = pf;
    const candles = await getCandlesForSignal(symbol, 'day', 500);
    if (candles.length < 50) {
      return res.status(422).json({
        error: `Insufficient candles (${candles.length}, need ≥50)`,
        count: candles.length,
      });
    }
    const ohlcv = candles.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0,
      time: c.time,
    }));

    const last = ohlcv[ohlcv.length - 1];
    const currentPrice = last?.close != null && Number.isFinite(Number(last.close)) ? Number(last.close) : null;
    if (!pricePassesBacktestFilter(currentPrice, minPrice, maxPrice)) {
      return res.status(422).json({
        error: 'Last daily close is outside the min/max price filter.',
        symbol,
        currentPrice,
        minPrice,
        maxPrice,
      });
    }

    const result = runRsiSetupBacktest(ohlcv, { maxHoldingDays, mode, thresholds });
    const payload = { symbol, currentPrice, minPrice, maxPrice, mode, thresholds, ...result };
    void persistBacktestRun({
      route: 'POST /api/signals/rsi-setup/backtest',
      method: 'POST',
      params: sanitizeBacktestRequest(req),
      response: payload,
    });
    res.json(payload);
  } catch (err) {
    logger.error('RSI Setup backtest failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'RSI Setup backtest failed' });
  }
});

/**
 * GET /api/signals/rsi-setup/backtest/combined?limit=&maxHoldingDays=&minPrice=&maxPrice=
 * Run RSI Setup backtest on all symbols with stored day candles (or up to limit). Returns { summary, results }.
 * Each result has symbol, tradesCount, winRate, totalReturn (no trades array to keep payload small).
 */
router.get('/rsi-setup/backtest/combined', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const mode = parseRsiSetupMode(req.query.mode);
    const th = parseRsiSetupThresholds(req.query);
    if ('error' in th) return res.status(400).json({ error: th.error });
    const { thresholds } = th;
    const mh = parseRsiBacktestMaxHoldingDays(req.query.maxHoldingDays);
    if ('error' in mh) {
      return res.status(400).json({ error: mh.error });
    }
    const maxHoldingDays = mh.value;
    const pf = parseRsiBacktestPriceFilter(req.query.minPrice, req.query.maxPrice);
    if ('error' in pf) {
      return res.status(400).json({ error: pf.error });
    }
    const { minPrice, maxPrice } = pf;

    const limitParam = parseInt(req.query.limit, 10);
    const cap = 5000;
    const maxSymbols = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(cap, limitParam) : cap;

    const symbols = await getSymbolsWithStoredCandles();
    const toRun = symbols.slice(0, maxSymbols);
    const results = [];
    let priceFilteredOut = 0;

    for (const { symbol: sym, tradingsymbol: ts } of toRun) {
      const inst = sym || ts;
      if (!inst) continue;
      try {
        const candles = await getCandlesForSignal(inst, 'day', 500);
        if (candles.length < 50) continue;
        const ohlcv = candles.map((c) => ({
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume ?? 0,
          time: c.time,
        }));
        const last = ohlcv[ohlcv.length - 1];
        const currentPrice = last?.close != null && Number.isFinite(Number(last.close)) ? Number(last.close) : null;
        if (!pricePassesBacktestFilter(currentPrice, minPrice, maxPrice)) {
          priceFilteredOut += 1;
          continue;
        }
        const result = runRsiSetupBacktest(ohlcv, { maxHoldingDays, mode, thresholds });
        results.push({
          symbol: inst,
          tradingsymbol: ts || inst,
          tradesCount: result.tradesCount ?? 0,
          winRate: result.winRate ?? 0,
          totalReturn: result.totalReturn ?? 0,
          currentPrice,
          mode,
        });
      } catch (err) {
        logger.warn('RSI Setup backtest combined skip', { symbol: inst, error: err?.message });
      }
    }

    results.sort((a, b) => (b.totalReturn ?? 0) - (a.totalReturn ?? 0));
    const summary = {
      totalSymbols: results.length,
      totalTrades: results.reduce((s, r) => s + (r.tradesCount ?? 0), 0),
      avgWinRate: results.length > 0
        ? results.reduce((s, r) => s + (r.winRate ?? 0), 0) / results.length
        : 0,
      priceFilteredOut,
    };
    const payload = { summary, results, maxHoldingDays, minPrice, maxPrice, mode, thresholds };
    void persistBacktestRun({
      route: 'GET /api/signals/rsi-setup/backtest/combined',
      method: 'GET',
      params: sanitizeBacktestRequest(req),
      response: payload,
    });
    res.json(payload);
  } catch (err) {
    logger.error('RSI Setup backtest combined failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'RSI Setup backtest combined failed' });
  }
});

/**
 * POST /api/signals/evaluate
 * Body: { instrument, tradingsymbol?, timeframe }
 * Runs full pipeline (indicators + ML + score + persist + alert) and returns the saved signal.
 */
router.post('/evaluate', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const { instrument, tradingsymbol, timeframe } = req.body || {};
    const sym = (instrument || tradingsymbol || '').trim();
    const tf = (timeframe || 'day').trim();
    if (!sym || !tf) {
      return res.status(400).json({ error: 'instrument and timeframe required' });
    }
    const signal = await evaluateAndPersistSignal({
      instrument: sym,
      tradingsymbol: (tradingsymbol || sym).trim(),
      timeframe: tf,
    });
    if (!signal) {
      return res.status(422).json({ error: 'Insufficient candle data for evaluation' });
    }
    res.json(signal);
  } catch (err) {
    logger.error('Evaluate signal failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Evaluate failed' });
  }
});

const EVALUATE_ALL_TIMEFRAMES = ['day', '60minute'];

/**
 * POST /api/signals/evaluate-all
 * Run evaluation for all symbols with stored candles, for 1D and 1H timeframes.
 * Returns { evaluated, errors, symbolCount }.
 */
router.post('/evaluate-all', async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({ error: 'Database not connected' });
  }
  try {
    const symbols = await getSymbolsWithStoredCandles();
    let evaluated = 0;
    const errors = [];
    for (const { symbol, tradingsymbol } of symbols) {
      const inst = symbol || tradingsymbol;
      const trad = tradingsymbol || symbol;
      if (!inst) continue;
      for (const timeframe of EVALUATE_ALL_TIMEFRAMES) {
        try {
          const signal = await evaluateAndPersistSignal({
            instrument: String(inst),
            tradingsymbol: String(trad),
            timeframe,
          });
          if (signal) evaluated += 1;
        } catch (err) {
          errors.push({ symbol: inst, timeframe, error: err?.message ?? 'Evaluate failed' });
        }
      }
    }
    res.json({ evaluated, errors, symbolCount: symbols.length });
  } catch (err) {
    logger.error('Evaluate-all failed', { error: err?.message });
    res.status(500).json({ error: err?.message ?? 'Evaluate-all failed' });
  }
});

/**
 * POST /api/signals/train
 * Trigger ML model training (proxies to ML service POST /train).
 * Returns { status, message?, stdout? }. 503 if ML_SERVICE_URL not set.
 */
router.post('/train', async (req, res) => {
  try {
    const data = await trainModel();
    res.json(data);
  } catch (err) {
    if (err?.code === 'ML_DISABLED') {
      return res.status(503).json({ error: 'ML service not configured (set ML_SERVICE_URL)' });
    }
    const status = err?.response?.status >= 400 ? err.response.status : 502;
    let message = err?.response?.data?.detail ?? err?.message ?? 'Training request failed';
    if (status === 502 && !err?.response) {
      message = 'ML service unreachable. Start it with: npm run ml (from project root).';
    }
    logger.error('Train failed', { error: err?.message, status: err?.response?.status, code: err?.code });
    res.status(status).json({ error: message });
  }
});

export default router;
