import { useState, useEffect, useRef, useMemo } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  CrosshairMode,
  createSeriesMarkers,
  LineStyle,
} from 'lightweight-charts';
import { getStoredCandlesSummary, getStoredCandles, getStoredCandlesSymbolsRsi } from '../api/kite';

const VOLUME_UP = '#26a69a';
const VOLUME_DOWN = '#ef5350';
const INDIA_TZ = 'Asia/Kolkata';

const tzOpts = { timeZone: INDIA_TZ, hour12: false };

/** Format time (unix seconds or Date) for chart crosshair: previous date style, time in IST. */
function formatTimeIST(time) {
  const ms = typeof time === 'number' ? time * 1000 : (time && time.getTime ? time.getTime() : 0);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Convert UTC ISO date (as stored in DB): previous date style, time in IST. */
function convertToIST(isoDate) {
  if (isoDate == null) return '—';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Short label for time axis tick marks in IST (≤8 chars when possible). */
function formatTickMarkIST(time, tickMarkType) {
  const ms = typeof time === 'number' ? time * 1000 : (time && time.getTime ? time.getTime() : 0);
  const d = new Date(ms);
  switch (tickMarkType) {
    case 0: return d.toLocaleString('en-IN', { ...tzOpts, year: 'numeric' });
    case 1: return d.toLocaleString('en-IN', { ...tzOpts, month: 'short' });
    case 2: return d.toLocaleString('en-IN', { ...tzOpts, day: 'numeric' });
    case 3: return d.toLocaleString('en-IN', { ...tzOpts, hour: '2-digit', minute: '2-digit' });
    case 4: return d.toLocaleString('en-IN', { ...tzOpts, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    default: return d.toLocaleString('en-IN', { ...tzOpts, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}

/** Prefer tradingsymbol (e.g. RELIANCE), fallback to symbol (instrument token). */
function stockDisplayName(candle) {
  const name = candle?.tradingsymbol?.trim();
  if (name) return name;
  return candle?.symbol ?? '—';
}

/** Safe number for OHLC: use fallback if value is missing, 0, or NaN. */
function ohlcNum(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : (Number.isFinite(Number(fallback)) ? Number(fallback) : null);
}

/** Convert stored candles (newest first) to chart data (oldest first) with time as unix seconds. Drops candles with invalid or zero OHLC. */
function candlesToChartData(candles) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const sorted = [...candles].sort((a, b) => {
    const ta = a.time ? new Date(a.time).getTime() : 0;
    const tb = b.time ? new Date(b.time).getTime() : 0;
    return ta - tb;
  });
  return sorted
    .filter((c) => {
      const close = Number(c.close);
      return c.time != null && Number.isFinite(close) && close > 0;
    })
    .map((c) => {
      const t = new Date(c.time).getTime();
      const close = Number(c.close);
      const open = ohlcNum(c.open, close) ?? close;
      const high = ohlcNum(c.high, close) ?? Math.max(open, close);
      const low = ohlcNum(c.low, close) ?? Math.min(open, close);
      return {
        time: Math.floor(t / 1000),
        open,
        high: Math.max(high, open, close, low),
        low: Math.min(low, open, close, high),
        close,
      };
    });
}

/** Build volume histogram data (time, value, color) from candles. */
function candlesToVolumeData(candles) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const sorted = [...candles].sort((a, b) => {
    const ta = a.time ? new Date(a.time).getTime() : 0;
    const tb = b.time ? new Date(b.time).getTime() : 0;
    return ta - tb;
  });
  return sorted
    .filter((c) => c.time != null)
    .map((c) => {
      const t = new Date(c.time).getTime();
      const close = Number(c.close);
      const open = Number(c.open);
      return {
        time: Math.floor(t / 1000),
        value: Number(c.volume) || 0,
        color: close >= open ? VOLUME_UP : VOLUME_DOWN,
      };
    });
}

/** Compute SMA of period over OHLC data (by time). Returns { time, value }[]. */
function computeSMA(ohlcData, period) {
  if (!Array.isArray(ohlcData) || ohlcData.length < period) return [];
  const out = [];
  for (let i = period - 1; i < ohlcData.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += ohlcData[i - j].close;
    out.push({ time: ohlcData[i].time, value: sum / period });
  }
  return out;
}

/** RSI with Wilder's smoothing (matches TradingView ta.rsi). Returns { time, value }[] in 0–100. */
function computeRSI(ohlcData, period = 14) {
  if (!Array.isArray(ohlcData) || ohlcData.length < period + 1) return [];
  const out = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let j = 1; j <= period; j++) {
    const ch = ohlcData[j].close - ohlcData[j - 1].close;
    if (ch > 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < ohlcData.length; i++) {
    if (i > period) {
      const ch = ohlcData[i].close - ohlcData[i - 1].close;
      const g = ch > 0 ? ch : 0;
      const l = ch < 0 ? -ch : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
    }
    const rs = avgLoss === 0 ? (avgGain > 0 ? Infinity : 1) : avgGain / avgLoss;
    const rsi = avgLoss === 0 && avgGain === 0 ? 50 : (avgGain === 0 ? 0 : 100 - 100 / (1 + rs));
    out.push({ time: ohlcData[i].time, value: Math.min(100, Math.max(0, rsi)) });
  }
  return out;
}

/** EMA of a series (for smoothed RSI). Same length as data; first period values use SMA seed then EMA. */
function computeEMA(data, period) {
  if (!Array.isArray(data) || data.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [];
  let ema = data[0].value;
  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      if (i > 0) ema = (ema * i + data[i].value) / (i + 1);
      out.push({ time: data[i].time, value: ema });
    } else {
      ema = data[i].value * k + ema * (1 - k);
      out.push({ time: data[i].time, value: ema });
    }
  }
  return out;
}

const RSI_DIVERGENCE_DEFAULTS = {
  lbL: 5,
  lbR: 5,
  rangeLower: 5,
  rangeUpper: 60,
  plotBull: true,
  plotHiddenBull: false,
  plotBear: true,
  plotHiddenBear: false,
};

/** Pivot low: bar i is pivot low if osc[i] is min in [i-left, i+right]. Returns indices. */
function findPivotLows(osc, left, right) {
  const out = [];
  for (let i = left; i < osc.length - right; i++) {
    let isMin = true;
    const v = osc[i];
    for (let j = i - left; j <= i + right && isMin; j++) if (osc[j] < v) isMin = false;
    if (isMin) out.push(i);
  }
  return out;
}

/** Pivot high: bar i is pivot high if osc[i] is max in [i-left, i+right]. Returns indices. */
function findPivotHighs(osc, left, right) {
  const out = [];
  for (let i = left; i < osc.length - right; i++) {
    let isMax = true;
    const v = osc[i];
    for (let j = i - left; j <= i + right && isMax; j++) if (osc[j] > v) isMax = false;
    if (isMax) out.push(i);
  }
  return out;
}

/**
 * RSI Divergence: detect regular/hidden bullish and bearish divergences.
 * combined: array of { time, rsi, low, high } (same length as rsiData, aligned with ohlc from period onward).
 * Returns { markers, rsiData, smoothedRsiData }.
 */
function computeRSIDivergence(combined, opts = {}) {
  const { lbL, lbR, rangeLower, rangeUpper, plotBull, plotHiddenBull, plotBear, plotHiddenBear } = { ...RSI_DIVERGENCE_DEFAULTS, ...opts };
  const osc = combined.map((c) => c.rsi);
  const markers = [];
  const plIndices = findPivotLows(osc, lbL, lbR);
  const phIndices = findPivotHighs(osc, lbL, lbR);

  for (let idx = 1; idx < plIndices.length; idx++) {
    const curr = plIndices[idx];
    const prev = plIndices[idx - 1];
    const bars = curr - prev;
    if (bars < rangeLower || bars > rangeUpper) continue;
    const currOsc = combined[curr].rsi;
    const prevOsc = combined[prev].rsi;
    const currLow = combined[curr].low;
    const prevLow = combined[prev].low;
    const regularBull = currOsc > prevOsc && currLow < prevLow;
    const hiddenBull = currOsc < prevOsc && currLow > prevLow;
    if (plotBull && regularBull) {
      markers.push({
        time: combined[curr].time,
        position: 'belowBar',
        shape: 'arrowUp',
        color: '#26a69a',
        text: ' Bull ',
      });
    }
    if (plotHiddenBull && hiddenBull) {
      markers.push({
        time: combined[curr].time,
        position: 'belowBar',
        shape: 'arrowUp',
        color: 'rgba(38, 166, 154, 0.5)',
        text: ' H Bull ',
      });
    }
  }

  for (let idx = 1; idx < phIndices.length; idx++) {
    const curr = phIndices[idx];
    const prev = phIndices[idx - 1];
    const bars = curr - prev;
    if (bars < rangeLower || bars > rangeUpper) continue;
    const currOsc = combined[curr].rsi;
    const prevOsc = combined[prev].rsi;
    const currHigh = combined[curr].high;
    const prevHigh = combined[prev].high;
    const regularBear = currOsc < prevOsc && currHigh > prevHigh;
    const hiddenBear = currOsc > prevOsc && currHigh < prevHigh;
    if (plotBear && regularBear) {
      markers.push({
        time: combined[curr].time,
        position: 'aboveBar',
        shape: 'arrowDown',
        color: '#ef5350',
        text: ' Bear ',
      });
    }
    if (plotHiddenBear && hiddenBear) {
      markers.push({
        time: combined[curr].time,
        position: 'aboveBar',
        shape: 'arrowDown',
        color: 'rgba(239, 83, 80, 0.5)',
        text: ' H Bear ',
      });
    }
  }

  return markers;
}

export function StoredDataPanel() {
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(null);
  const [instrumentInput, setInstrumentInput] = useState('');
  const [candles, setCandles] = useState([]);
  const [chartTimeframeFilter, setChartTimeframeFilter] = useState(null); // '60minute' | 'day' | null
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState(null);
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const sma20Ref = useRef(null);
  const sma50Ref = useRef(null);
  const rsiRef = useRef(null);
  const rsiSmoothedRef = useRef(null);
  const rsiMarkersRef = useRef(null);
  const [chartOptions, setChartOptions] = useState({
    showVolume: true,
    showSma20: false,
    showSma50: false,
    showRsi: false,
    crosshairMagnet: true,
  });
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const chartWrapRef = useRef(null);
  /** RSI pane height as fraction of chart (0.1–0.5). User can drag to resize. */
  const [rsiPaneRatio, setRsiPaneRatio] = useState(0.2);
  const [isRsiDragging, setIsRsiDragging] = useState(false);
  const [zoomButtonsHover, setZoomButtonsHover] = useState(false);
  const [rsiHandleHover, setRsiHandleHover] = useState(false);
  const [symbolsRsi, setSymbolsRsi] = useState([]);
  const [symbolsRsiLoading, setSymbolsRsiLoading] = useState(false);
  const [rsiFilter, setRsiFilter] = useState('all'); // 'all' | 'rsi35_60' | 'rest'

  const displayedCandles = useMemo(
    () =>
      chartTimeframeFilter && candles.length > 0
        ? candles.filter((c) => c.timeframe === chartTimeframeFilter)
        : candles,
    [candles, chartTimeframeFilter]
  );

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    setSummaryError(null);
    getStoredCandlesSummary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((e) => {
        if (!cancelled) setSummaryError(e?.message ?? 'Failed to load summary');
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!summary?.symbols?.length) {
      setSymbolsRsi([]);
      return;
    }
    let cancelled = false;
    setSymbolsRsiLoading(true);
    getStoredCandlesSymbolsRsi({ timeframe: 'day', period: 14 })
      .then((data) => {
        if (!cancelled && Array.isArray(data.symbols)) setSymbolsRsi(data.symbols);
      })
      .catch(() => {
        if (!cancelled) setSymbolsRsi([]);
      })
      .finally(() => {
        if (!cancelled) setSymbolsRsiLoading(false);
      });
    return () => { cancelled = true; };
  }, [summary?.symbols?.length]);

  // Chart: create/update when displayed candles or options change
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const ohlcData = candlesToChartData(displayedCandles);
    if (ohlcData.length === 0) {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        candlestickRef.current = null;
        volumeSeriesRef.current = null;
        sma20Ref.current = null;
        sma50Ref.current = null;
        rsiRef.current = null;
        rsiSmoothedRef.current = null;
        rsiMarkersRef.current = null;
      }
      return;
    }
    const { showVolume, showSma20, showSma50, showRsi, crosshairMagnet } = chartOptions;
    const volumeData = candlesToVolumeData(displayedCandles);
    const sma20Data = computeSMA(ohlcData, 20);
    const sma50Data = computeSMA(ohlcData, 50);
    const rsiData = computeRSI(ohlcData, 14);
    const period = 14;
    const combined = rsiData.length > 0 ? rsiData.map((r, i) => ({
      time: r.time,
      rsi: r.value,
      low: ohlcData[period + i].low,
      high: ohlcData[period + i].high,
    })) : [];
    const rsiDivergenceMarkers = combined.length > 0 ? computeRSIDivergence(combined) : [];
    const rsiSmoothedData = computeEMA(rsiData, 10);

    if (!chartRef.current) {
      const containerEl = chartContainerRef.current;
      const w = containerEl.clientWidth || 1;
      const chartHeight = containerEl.clientHeight || 360;
      if (w < 1) return;
      const chart = createChart(containerEl, {
        layout: { background: { color: '#0f1419' }, textColor: '#8b98a5' },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        width: w,
        height: chartHeight,
        crosshair: {
          mode: crosshairMagnet ? CrosshairMode.Magnet : CrosshairMode.Normal,
          vertLine: { color: 'rgba(117, 134, 150, 0.35)' },
          horzLine: { color: 'rgba(117, 134, 150, 0.35)' },
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 12,
          tickMarkFormatter: (time, tickMarkType) => formatTickMarkIST(time, tickMarkType),
        },
        rightPriceScale: { borderColor: '#2f3336' },
        localization: {
          locale: 'en-IN',
          timeFormatter: (time) => formatTimeIST(time),
        },
      });
      const mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: true,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      });
      const bottomMargin = showVolume ? 0.4 : showRsi ? rsiPaneRatio : 0.1;
      mainSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: bottomMargin } });
      mainSeries.setData(ohlcData);
      candlestickRef.current = mainSeries;
      chartRef.current = chart;

      const volSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.7, bottom: 0 } });
      volSeries.setData(volumeData);
      volSeries.applyOptions({ visible: showVolume });
      volumeSeriesRef.current = volSeries;

      const sma20Series = chart.addSeries(LineSeries, { color: '#2196f3', lineWidth: 2 });
      sma20Series.setData(sma20Data);
      sma20Series.applyOptions({ visible: showSma20 });
      sma20Ref.current = sma20Series;

      const sma50Series = chart.addSeries(LineSeries, { color: '#ff9800', lineWidth: 2 });
      sma50Series.setData(sma50Data);
      sma50Series.applyOptions({ visible: showSma50 });
      sma50Ref.current = sma50Series;

      const rsiSeries = chart.addSeries(LineSeries, {
        color: '#2962FF',
        lineWidth: 2,
        priceScaleId: 'rsi',
      });
      rsiSeries.setData(rsiData);
      rsiSeries.applyOptions({ visible: showRsi });
      rsiSeries.priceScale().applyOptions({
        scaleMargins: { top: showRsi ? 1 - rsiPaneRatio : 0.85, bottom: 0 },
        borderVisible: true,
        minimum: 0,
        maximum: 100,
      });
      rsiSeries.createPriceLine({ price: 50, color: 'rgba(120, 123, 134, 0.4)', lineStyle: LineStyle.Dotted, lineWidth: 1, title: '50' });
      rsiSeries.createPriceLine({ price: 70, color: 'rgba(120, 123, 134, 0.4)', lineStyle: LineStyle.Dotted, lineWidth: 1, title: 'OB' });
      rsiSeries.createPriceLine({ price: 30, color: 'rgba(120, 123, 134, 0.4)', lineStyle: LineStyle.Dotted, lineWidth: 1, title: 'OS' });
      const rsiMarkersApi = createSeriesMarkers(rsiSeries, rsiDivergenceMarkers);
      rsiMarkersRef.current = rsiMarkersApi;
      rsiRef.current = rsiSeries;

      const rsiSmoothedSeries = chart.addSeries(LineSeries, {
        color: '#ff9800',
        lineWidth: 2,
        priceScaleId: 'rsi',
      });
      rsiSmoothedSeries.setData(rsiSmoothedData);
      rsiSmoothedSeries.applyOptions({ visible: showRsi });
      rsiSmoothedRef.current = rsiSmoothedSeries;

      const applyChartSize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight || 360,
          });
        }
      };
      const resizeObserver = new ResizeObserver(applyChartSize);
      resizeObserver.observe(chartContainerRef.current);
      window.addEventListener('resize', applyChartSize);
      return () => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', applyChartSize);
        chart.remove();
        chartRef.current = null;
        candlestickRef.current = null;
        volumeSeriesRef.current = null;
        sma20Ref.current = null;
        sma50Ref.current = null;
        rsiRef.current = null;
        rsiSmoothedRef.current = null;
        rsiMarkersRef.current = null;
      };
    }

    const bottomMargin = showVolume ? 0.4 : showRsi ? rsiPaneRatio : 0.1;
    candlestickRef.current.setData(ohlcData);
    candlestickRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: bottomMargin } });
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(volumeData);
      volumeSeriesRef.current.applyOptions({ visible: showVolume });
    }
    if (sma20Ref.current) {
      sma20Ref.current.setData(sma20Data);
      sma20Ref.current.applyOptions({ visible: showSma20 });
    }
    if (sma50Ref.current) {
      sma50Ref.current.setData(sma50Data);
      sma50Ref.current.applyOptions({ visible: showSma50 });
    }
    if (rsiRef.current) {
      rsiRef.current.setData(rsiData);
      rsiRef.current.applyOptions({ visible: showRsi });
      rsiRef.current.priceScale().applyOptions({
        scaleMargins: { top: showRsi ? 1 - rsiPaneRatio : 0.85, bottom: 0 },
      });
    }
    if (rsiMarkersRef.current) {
      rsiMarkersRef.current.setMarkers(rsiDivergenceMarkers);
    }
    if (rsiSmoothedRef.current) {
      rsiSmoothedRef.current.setData(rsiSmoothedData);
      rsiSmoothedRef.current.applyOptions({ visible: showRsi });
    }
    chartRef.current.applyOptions({
      crosshair: {
        mode: crosshairMagnet ? CrosshairMode.Magnet : CrosshairMode.Normal,
        vertLine: { color: 'rgba(117, 134, 150, 0.35)' },
        horzLine: { color: 'rgba(117, 134, 150, 0.35)' },
      },
    });
  }, [displayedCandles, chartOptions, rsiPaneRatio]);

  const handleChartFitContent = () => {
    if (chartRef.current) chartRef.current.timeScale().fitContent();
  };

  const handleChartZoomIn = () => {
    if (!chartRef.current) return;
    const ts = chartRef.current.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const width = range.to - range.from;
    const center = (range.from + range.to) / 2;
    const newWidth = Math.max(5, width * 0.75);
    ts.setVisibleLogicalRange({ from: center - newWidth / 2, to: center + newWidth / 2 });
  };

  const handleChartZoomOut = () => {
    if (!chartRef.current) return;
    const ts = chartRef.current.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const width = range.to - range.from;
    const center = (range.from + range.to) / 2;
    const newWidth = Math.min(Number.MAX_SAFE_INTEGER, width * 1.35);
    ts.setVisibleLogicalRange({ from: center - newWidth / 2, to: center + newWidth / 2 });
  };

  const toggleChartFullscreen = () => {
    const wrap = chartWrapRef.current;
    if (!wrap) return;
    if (!document.fullscreenElement) {
      wrap.requestFullscreen?.();
      setIsChartFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsChartFullscreen(false);
    }
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsChartFullscreen(!!document.fullscreenElement);
      if (chartRef.current && chartContainerRef.current) {
        setTimeout(() => {
          const el = chartContainerRef.current;
          if (el && chartRef.current) {
            chartRef.current.applyOptions({
              width: el.clientWidth,
              height: el.clientHeight || 360,
            });
          }
        }, 100);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const handleRsiResizeStart = (e) => {
    e.preventDefault();
    setIsRsiDragging(true);
  };

  useEffect(() => {
    if (!isRsiDragging) return;
    const minRatio = 0.1;
    const maxRatio = 0.5;
    const onMove = (e) => {
      const el = chartContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const ratio = (rect.bottom - clientY) / rect.height;
      setRsiPaneRatio(Math.min(maxRatio, Math.max(minRatio, ratio)));
    };
    const onEnd = () => setIsRsiDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [isRsiDragging]);

  const loadChart = async (overrideInput) => {
    const trimmed = (overrideInput != null ? String(overrideInput) : instrumentInput).trim();
    if (!trimmed) {
      setQueryError('Enter instrument name or token');
      return;
    }
    if (overrideInput != null) setInstrumentInput(trimmed);
    setQueryError(null);
    setCandles([]);
    setChartTimeframeFilter(null);
    setQueryLoading(true);
    try {
      const isToken = /^\d+$/.test(trimmed);
      const baseParams = isToken ? { symbol: trimmed } : { tradingsymbol: trimmed };
      const [dayRes, hourRes] = await Promise.all([
        getStoredCandles({ ...baseParams, timeframe: 'day', limit: 2000 }),
        getStoredCandles({ ...baseParams, timeframe: '60minute', limit: 5000 }),
      ]);
      const dayCandles = Array.isArray(dayRes.candles) ? dayRes.candles : [];
      const hourCandles = Array.isArray(hourRes.candles) ? hourRes.candles : [];
      const merged = [...dayCandles, ...hourCandles];
      setCandles(merged);
      setChartTimeframeFilter(merged.length ? 'day' : null);
    } catch (e) {
      setQueryError(e?.message ?? 'Load failed');
    } finally {
      setQueryLoading(false);
    }
  };

  const symbolList = (summary?.symbols || [])
    .slice()
    .sort((a, b) => (a.tradingsymbol || a.symbol || '').localeCompare(b.tradingsymbol || b.symbol || '', 'en'));

  const rsiBySymbol = useMemo(() => {
    const m = new Map();
    for (const row of symbolsRsi) {
      if (row.symbol != null) m.set(String(row.symbol), row.rsi);
    }
    return m;
  }, [symbolsRsi]);

  const filteredSymbolList = useMemo(() => {
    if (rsiFilter === 'all') return symbolList;
    return symbolList.filter((s) => {
      const rsi = rsiBySymbol.get(s.symbol);
      if (rsiFilter === 'rsi35_60') return rsi != null && rsi >= 35 && rsi <= 60;
      if (rsiFilter === 'rest') return rsi == null || rsi < 35 || rsi > 60;
      return true;
    });
  }, [symbolList, rsiFilter, rsiBySymbol]);

  const rsi35_60Count = useMemo(
    () => symbolList.filter((s) => { const r = rsiBySymbol.get(s.symbol); return r != null && r >= 35 && r <= 60; }).length,
    [symbolList, rsiBySymbol]
  );
  const restCount = useMemo(
    () => symbolList.filter((s) => { const r = rsiBySymbol.get(s.symbol); return r == null || r < 35 || r > 60; }).length,
    [symbolList, rsiBySymbol]
  );

  const copySymbolList = () => {
    const text = filteredSymbolList
      .map((s) => (s.tradingsymbol && s.tradingsymbol.trim()) ? s.tradingsymbol.trim() : (s.symbol || ''))
      .filter(Boolean)
      .join('\n');
    if (text && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  };

  return (
    <div className="stored-data-panel" style={{ maxWidth: 900 }}>
      <h2 style={{ fontSize: '1rem', margin: '0 0 8px', color: '#e7e9ea' }}>
        Stored candle data
      </h2>
      <p className="muted" style={{ fontSize: '0.85em', marginBottom: 12 }}>
        Summary of NSE historical data (synced via NSE Sync tab). Enter instrument name or token to load 5 years 1D + 1H chart.
      </p>

      <section style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: '0.95rem', margin: '0 0 8px' }}>Summary</h3>
        {summaryLoading && <p className="muted">Loading…</p>}
        {summaryError && (
          <p className="bot-live-error" style={{ marginBottom: 8 }}>
            {summaryError}
          </p>
        )}
        {!summaryLoading && summary && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <div><strong>Total candles:</strong> {summary.totalCandles?.toLocaleString() ?? 0}</div>
            <div><strong>Symbols:</strong> {summary.symbolCount ?? 0}</div>
            {summary.byTimeframe && Object.keys(summary.byTimeframe).length > 0 && (
              <div>
                <strong>By timeframe:</strong>{' '}
                {Object.entries(summary.byTimeframe)
                  .map(([tf, count]) => `${tf}: ${count?.toLocaleString() ?? 0}`)
                  .join(', ')}
              </div>
            )}
          </div>
        )}
        {/* {summary?.sampleSymbols?.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <strong>Sample (symbol × timeframe, count):</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: '0.9rem' }}>
              {summary.sampleSymbols.slice(0, 10).map((s, i) => (
                <li key={i}>{s.symbol} × {s.timeframe}: {s.count?.toLocaleString()}</li>
              ))}
            </ul>
          </div>
        )} */}
      </section>

      <section>
        <h3 style={{ fontSize: '0.95rem', margin: '0 0 8px' }}>Chart</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <label htmlFor="rsi-filter" style={{ fontSize: '0.85rem', color: '#8b98a5' }}>Filter:</label>
            <select
              id="rsi-filter"
              className="bot-live-input"
              style={{ minWidth: 120 }}
              value={rsiFilter}
              onChange={(e) => setRsiFilter(e.target.value)}
              title="Filter symbol list by RSI (daily)"
            >
              <option value="all">All ({symbolList.length})</option>
              <option value="rsi35_60" disabled={symbolsRsiLoading}>
                {symbolsRsiLoading ? 'RSI 35–60 (…)' : `RSI 35–60 (${rsi35_60Count})`}
              </option>
              <option value="rest" disabled={symbolsRsiLoading}>
                {symbolsRsiLoading ? 'Rest (…)' : `Rest (${restCount})`}
              </option>
            </select>
          </span>
          <select
            className="bot-live-input"
            style={{ minWidth: 200 }}
            value={instrumentInput}
            onChange={(e) => {
              const v = e.target.value;
              setInstrumentInput(v);
              if (v) loadChart(v);
            }}
            title="Select symbol to load chart"
          >
            <option value="">Select symbol ({filteredSymbolList.length})</option>
            {filteredSymbolList.map((s) => {
              const display = (s.tradingsymbol && s.tradingsymbol.trim()) ? s.tradingsymbol.trim() : (s.symbol || '');
              const value = display || s.symbol || '';
              return (
                <option key={s.symbol} value={value}>
                  {display || s.symbol}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            className="bot-live-button"
            style={{ padding: '4px 10px', fontSize: '0.85rem' }}
            onClick={copySymbolList}
            disabled={filteredSymbolList.length === 0}
            title="Copy symbol list to clipboard (one per line)"
          >
            Copy list
          </button>
          <input
            type="text"
            placeholder="Or type name / token"
            value={instrumentInput}
            onChange={(e) => setInstrumentInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadChart()}
            className="bot-live-input"
            style={{ width: 160 }}
          />
          <button
            type="button"
            className="bot-live-button"
            onClick={() => loadChart()}
            disabled={queryLoading}
          >
            {queryLoading ? 'Loading…' : 'Load chart'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: -4, marginBottom: 8 }}>
          5 years 1D + 1H data. Use 1D / 1H / All above the chart to switch view.
        </p>
        {queryError && (
          <p className="bot-live-error" style={{ marginBottom: 8 }}>{queryError}</p>
        )}
        {candles.length > 0 && (
          <>
            <div
              ref={chartWrapRef}
              className="stored-data-chart-wrap"
              style={{
                marginBottom: 16,
                background: '#0f1419',
                borderRadius: 8,
                padding: 8,
                ...(isChartFullscreen ? { height: '100vh', display: 'flex', flexDirection: 'column' } : {}),
              }}
            >
              <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0, color: '#e7e9ea', minWidth: 0, display: 'flex', alignItems: 'center' }}>
                  <span style={{ color: '#8b98a5', fontWeight: 500 }}>Stock: </span>
                  {stockDisplayName(displayedCandles[0] ?? candles[0])}
                  <span style={{ fontWeight: 400, color: '#8b98a5', fontSize: '0.9rem' }}> · {chartTimeframeFilter === '60minute' ? '1H' : chartTimeframeFilter === 'day' ? '1D' : (displayedCandles[0]?.timeframe ?? candles[0]?.timeframe ?? '')} · {displayedCandles.length} candles</span>
                </h3>
                {candles.some((c) => c.timeframe === '60minute') && candles.some((c) => c.timeframe === 'day') && (
                  <span style={{ display: 'inline-flex', gap: 4, alignItems: 'stretch' }}>
                    <button type="button" className="bot-live-button" style={{ padding: '6px 10px', fontSize: '0.8rem', minHeight: 32, ...(chartTimeframeFilter === '60minute' ? { opacity: 1, fontWeight: 600 } : { opacity: 0.7 }) }} onClick={() => setChartTimeframeFilter('60minute')}>1H</button>
                    <button type="button" className="bot-live-button" style={{ padding: '6px 10px', fontSize: '0.8rem', minHeight: 32, ...(chartTimeframeFilter === 'day' ? { opacity: 1, fontWeight: 600 } : { opacity: 0.7 }) }} onClick={() => setChartTimeframeFilter('day')}>1D</button>
                    <button type="button" className="bot-live-button" style={{ padding: '6px 10px', fontSize: '0.8rem', minHeight: 32, ...(chartTimeframeFilter === null ? { opacity: 1, fontWeight: 600 } : { opacity: 0.7 }) }} onClick={() => setChartTimeframeFilter(null)}>All</button>
                  </span>
                )}
                <span style={{ marginLeft: 'auto', display: 'inline-flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <button type="button" className="bot-live-button" style={{ padding: '6px 10px', fontSize: '0.75rem', minHeight: 32 }} onClick={handleChartFitContent} title="Fit all data in view. Scroll on chart to zoom, drag to pan.">Fit</button>
                  <button type="button" className="bot-live-button" style={{ padding: '6px 10px', fontSize: '0.75rem', minHeight: 32 }} onClick={toggleChartFullscreen} title="Fullscreen">{isChartFullscreen ? 'Exit FS' : 'Fullscreen'}</button>
                  <button type="button" className="bot-live-button" style={{ padding: '6px 10px', fontSize: '0.75rem', minHeight: 32, ...(chartOptions.crosshairMagnet ? { opacity: 1 } : { opacity: 0.7 }) }} onClick={() => setChartOptions((o) => ({ ...o, crosshairMagnet: !o.crosshairMagnet }))} title="Crosshair snap to candle">Crosshair</button>
                  <button type="button" className="bot-live-button" style={{ padding: '6px 10px', fontSize: '0.75rem', minHeight: 32, ...(chartOptions.showVolume ? { opacity: 1 } : { opacity: 0.7 }) }} onClick={() => setChartOptions((o) => ({ ...o, showVolume: !o.showVolume }))}>Volume</button>
                  <button type="button" className="bot-live-button" style={{ padding: '6px 10px', fontSize: '0.75rem', minHeight: 32, ...(chartOptions.showSma20 ? { opacity: 1 } : { opacity: 0.7 }) }} onClick={() => setChartOptions((o) => ({ ...o, showSma20: !o.showSma20 }))}>SMA 20</button>
                  <button type="button" className="bot-live-button" style={{ padding: '6px 10px', fontSize: '0.75rem', minHeight: 32, ...(chartOptions.showSma50 ? { opacity: 1 } : { opacity: 0.7 }) }} onClick={() => setChartOptions((o) => ({ ...o, showSma50: !o.showSma50 }))}>SMA 50</button>
                  <button type="button" className="bot-live-button" style={{ padding: '6px 10px', fontSize: '0.75rem', minHeight: 32, ...(chartOptions.showRsi ? { opacity: 1 } : { opacity: 0.7 }) }} onClick={() => setChartOptions((o) => ({ ...o, showRsi: !o.showRsi }))}>RSI</button>
                </span>
              </div>
              <div
                style={{
                  position: 'relative',
                  userSelect: isRsiDragging ? 'none' : undefined,
                  ...(isChartFullscreen ? { flex: 1, minHeight: 0 } : {}),
                }}
              >
                <div
                  ref={chartContainerRef}
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    width: '100%',
                    ...(isChartFullscreen ? { height: '100%' } : { height: 360 }),
                  }}
                />
                {chartOptions.showRsi && candles.length > 0 && (
                  <div
                    aria-hidden
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: `${rsiPaneRatio * 100}%`,
                      background: 'linear-gradient(180deg, rgba(22, 28, 36, 0.72) 0%, rgba(15, 20, 25, 0.72) 100%)',
                      pointerEvents: 'none',
                      zIndex: 2,
                      borderRadius: '0 0 8px 8px',
                      borderTop: '1px solid rgba(47, 51, 54, 0.9)',
                    }}
                  />
                )}
                {chartOptions.showRsi && candles.length > 0 && (
                  <div
                    role="separator"
                    aria-label="Resize RSI pane"
                    title="Drag to resize RSI pane"
                    onMouseDown={handleRsiResizeStart}
                    onTouchStart={handleRsiResizeStart}
                    onMouseEnter={() => setRsiHandleHover(true)}
                    onMouseLeave={() => setRsiHandleHover(false)}
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: `${(1 - rsiPaneRatio) * 100}%`,
                      transform: 'translateY(-50%)',
                      height: 2,
                      cursor: 'ns-resize',
                      zIndex: 10,
                      background: rsiHandleHover ? 'rgba(62, 8, 77, 0.9)' : 'rgba(120, 123, 134, 0.3)',
                      borderTop: '1px solid rgba(62, 8, 77, 0.9)',
                      borderBottom: '1px solid rgba(62, 8, 77, 0.9)',
                      transition: 'background 0.15s ease',
                    }}
                  />
                )}
                <div
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: 12,
                    pointerEvents: 'none',
                    color: 'rgba(255,255,255,0.5)',
                    fontSize: 18,
                    fontWeight: 600,
                  }}
                >
                  {stockDisplayName(displayedCandles[0] ?? candles[0])}
                </div>
                <div
                  className="chart-zoom-buttons"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    justifyContent: 'center',
                    gap: 4,
                    padding: '8px 0 10px',
                    pointerEvents: 'none',
                    zIndex: 5,
                  }}
                >
                  <span
                    style={{ display: 'inline-flex', gap: 4, pointerEvents: 'auto' }}
                    onMouseEnter={() => setZoomButtonsHover(true)}
                    onMouseLeave={() => setZoomButtonsHover(false)}
                  >
                  <button
                    type="button"
                    className="bot-live-button chart-zoom-btn"
                    style={{
                      minWidth: 32,
                      padding: '4px 10px',
                      fontSize: '1rem',
                      lineHeight: 1,
                      pointerEvents: 'auto',
                      background: zoomButtonsHover ? 'rgba(30, 36, 45, 0.98)' : 'transparent',
                      border: zoomButtonsHover ? '1px solid #2f3336' : '1px solid transparent',
                      color: zoomButtonsHover ? '#e7e9ea' : 'rgba(255,255,255,0.6)',
                    }}
                    onClick={handleChartZoomOut}
                    title="Zoom out (or scroll on chart)"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="bot-live-button chart-zoom-btn"
                    style={{
                      minWidth: 32,
                      padding: '4px 10px',
                      fontSize: '1rem',
                      lineHeight: 1,
                      pointerEvents: 'auto',
                      background: zoomButtonsHover ? 'rgba(30, 36, 45, 0.98)' : 'transparent',
                      border: zoomButtonsHover ? '1px solid #2f3336' : '1px solid transparent',
                      color: zoomButtonsHover ? '#e7e9ea' : 'rgba(255,255,255,0.6)',
                    }}
                    onClick={handleChartZoomIn}
                    title="Zoom in (or scroll on chart)"
                  >
                    +
                  </button>
                  </span>
                </div>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <p className="muted" style={{ marginBottom: 4 }}>Table (newest first){displayedCandles.length !== candles.length ? ` · ${displayedCandles.length} shown` : ''}</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>name</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>symbol</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>timeframe</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>time</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>O</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>H</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>L</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>C</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>vol</th>
                </tr>
              </thead>
              <tbody>
                {displayedCandles.map((c, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #38444d' }}>{stockDisplayName(c)}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #38444d' }}>{c.symbol}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #38444d' }}>{c.timeframe}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid #38444d' }}>
                      {convertToIST(c.time)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>{c.open}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>{c.high}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>{c.low}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>{c.close}</td>
                    <td style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid #38444d' }}>{c.volume ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
