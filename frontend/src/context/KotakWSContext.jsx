import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { evaluate as evaluateEmaCrossover } from '../utils/emaCrossover.js';
import { pushStoredCandles } from '../api/kite.js';

const HSM_URL = 'wss://mlhsm.kotaksecurities.com';
const THROTTLE_MS = 30000;

const KotakWSContext = createContext(null);

const CHART_DATA_MAX = 500;
const EMA_CANDLES_MAX = 50;
const EMA_WARMUP = 21;

/** Extract LTP ticks from HSM message (array of { ltp, tk, e, ... } or single object). */
function extractChartTicks(parsed) {
  const ticks = [];
  const now = Math.floor(Date.now() / 1000);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  for (const item of items) {
    if (item == null || typeof item !== 'object') continue;
    const ltp = parseFloat(item.ltp ?? item.LTP);
    if (Number.isFinite(ltp)) {
      ticks.push({
        time: now,
        value: ltp,
        symbol: item.tk ?? item.ts ?? item.symbol,
      });
    }
  }
  return ticks;
}

const SECONDS_PER_DAY = 86400;

/** Build 1H + 1D candles from LTP ticks and run EMA 10/20 on 1H. Returns { emaUpdates, completedCandles }. */
function build1HCandlesAndEma(ticks, buffersRef) {
  if (!ticks.length) return { emaUpdates: null, completedCandles: [] };
  const updates = {};
  const completedCandles = [];
  for (const tick of ticks) {
    const { time, value, symbol } = tick;
    const sym = String(symbol ?? '').trim();
    if (!sym || !Number.isFinite(value)) continue;
    const t = Number(time);
    const bucket1H = Math.floor(t / 3600) * 3600;
    const bucket1D = Math.floor(t / SECONDS_PER_DAY) * SECONDS_PER_DAY;

    let buf = buffersRef.current[sym];
    if (!buf) {
      buf = {
        currentBucket: null,
        currentCandle: null,
        completed: [],
        currentBucket1D: null,
        currentCandle1D: null,
      };
      buffersRef.current[sym] = buf;
    }

    // --- 1H ---
    if (buf.currentBucket !== null && bucket1H !== buf.currentBucket && buf.currentCandle) {
      const completed = { ...buf.currentCandle };
      buf.completed.push(completed);
      completedCandles.push({ symbol: sym, candle: completed, timeframe: '60minute' });
      if (buf.completed.length > EMA_CANDLES_MAX) buf.completed.shift();
      buf.currentCandle = null;
    }
    if (buf.currentCandle == null) {
      buf.currentCandle = { open: value, high: value, low: value, close: value, time: bucket1H };
      buf.currentBucket = bucket1H;
    } else {
      buf.currentCandle.high = Math.max(buf.currentCandle.high, value);
      buf.currentCandle.low = Math.min(buf.currentCandle.low, value);
      buf.currentCandle.close = value;
    }

    // --- 1D ---
    if (buf.currentBucket1D !== null && bucket1D !== buf.currentBucket1D && buf.currentCandle1D) {
      const completed = { ...buf.currentCandle1D };
      completedCandles.push({ symbol: sym, candle: completed, timeframe: 'day' });
      buf.currentCandle1D = null;
    }
    if (buf.currentCandle1D == null) {
      buf.currentCandle1D = { open: value, high: value, low: value, close: value, time: bucket1D };
      buf.currentBucket1D = bucket1D;
    } else {
      buf.currentCandle1D.high = Math.max(buf.currentCandle1D.high, value);
      buf.currentCandle1D.low = Math.min(buf.currentCandle1D.low, value);
      buf.currentCandle1D.close = value;
    }

    if (buf.completed.length >= EMA_WARMUP) {
      const closes = buf.completed.map((c) => c.close);
      updates[sym] = evaluateEmaCrossover(closes);
    }
  }
  return {
    emaUpdates: Object.keys(updates).length ? updates : null,
    completedCandles,
  };
}

export function KotakWSProvider({ children }) {
  const [status, setStatus] = useState('idle'); // idle | connecting | open | error | closed
  const [logs, setLogs] = useState([]);
  const [chartData, setChartData] = useState([]); // { time, value, symbol }[] for lightweight-charts
  const [emaSignals, setEmaSignals] = useState({}); // { [symbol]: { signal, entryPrice, explanation } }
  const wsRef = useRef(null);
  const throttleRef = useRef(null);
  const sessionRef = useRef(null);
  const candleBuffersRef = useRef({});

  const addLog = useCallback((line, isError = false) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-199), { ts, line, isError }]);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);
  const clearChartData = useCallback(() => setChartData([]), []);

  const clearCandleBuffers = useCallback(() => {
    candleBuffersRef.current = {};
    setEmaSignals({});
  }, []);

  const disconnect = useCallback(() => {
    if (throttleRef.current) {
      clearInterval(throttleRef.current);
      throttleRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (_) {}
      wsRef.current = null;
    }
    sessionRef.current = null;
    setStatus('closed');
    setChartData([]);
    candleBuffersRef.current = {};
    setEmaSignals({});
    addLog('Disconnected');
  }, [addLog]);

  const connect = useCallback(
    (session) => {
      if (!session?.auth || !session?.sid) {
        addLog('HSM needs Auth/Sid; they are kept server-side. Use "Bot live" for market data.', true);
        return;
      }
      if (typeof window.HSWebSocket === 'undefined') {
        addLog('HSWebSocket not loaded. Ensure /websocket/hslib.js is loaded.', true);
        return;
      }

      disconnect();
      sessionRef.current = session;
      setStatus('connecting');
      addLog(`Connecting to ${HSM_URL}...`);

      const ws = new window.HSWebSocket(HSM_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('open');
        addLog('Connected');
        if (session?.sessionId && !session?.auth) {
        addLog('Direct HSM connect not available with sessionId (tokens are server-side). Use Bot live for market data.', true);
        setStatus('idle');
        return;
      }
      const payload = {
          type: 'cn',
          Authorization: session.auth,
          Sid: session.sid,
        };
        ws.send(JSON.stringify(payload));
        throttleRef.current = setInterval(() => {
          if (wsRef.current) {
            try {
              wsRef.current.send(JSON.stringify({ type: 'ti', scrips: '' }));
            } catch (_) {}
          }
        }, THROTTLE_MS);
      };

      ws.onclose = () => {
        if (throttleRef.current) {
          clearInterval(throttleRef.current);
          throttleRef.current = null;
        }
        wsRef.current = null;
        setStatus((s) => (s === 'connecting' ? 'error' : 'closed'));
        addLog('Connection closed');
      };

      ws.onerror = () => {
        setStatus('error');
        addLog('WebSocket error', true);
      };

      ws.onmessage = (msg) => {
        try {
          const text = typeof msg === 'string' ? msg : (msg.data ?? '');
          const parsed = JSON.parse(text);
          addLog(Array.isArray(parsed) ? JSON.stringify(parsed) : text);
          const ticks = extractChartTicks(parsed);
          if (ticks.length > 0) {
            setChartData((prev) => {
              const next = [...prev, ...ticks];
              return next.slice(-CHART_DATA_MAX);
            });
            const { emaUpdates, completedCandles } = build1HCandlesAndEma(ticks, candleBuffersRef);
            if (emaUpdates) {
              setEmaSignals((prev) => ({ ...prev, ...emaUpdates }));
            }
            if (completedCandles.length > 0) {
              const toPush = completedCandles.map(({ symbol, candle, timeframe }) => ({
                symbol,
                tradingsymbol: symbol,
                timeframe: timeframe || '60minute',
                time: candle.time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: 0,
              }));
              pushStoredCandles(toPush).catch(() => {});
            }
          }
        } catch {
          addLog(String(msg?.data ?? msg));
        }
      };
    },
    [addLog, disconnect]
  );

  const subscribe = useCallback((type, scrips, channelNum = 1) => {
    const ws = wsRef.current;
    if (!ws) {
      addLog('Not connected. Connect first.', true);
      return;
    }
    const payload = { type, scrips: scrips.trim(), channelnum: Number(channelNum) || 1 };
    ws.send(JSON.stringify(payload));
    addLog(`Subscribe ${type}: ${scrips.slice(0, 60)}${scrips.length > 60 ? '...' : ''}`);
  }, [addLog]);

  const subscribeScrips = useCallback(
    (scrips, channelNum) => subscribe('mws', scrips, channelNum),
    [subscribe]
  );
  const subscribeIndex = useCallback(
    (scrips, channelNum) => subscribe('ifs', scrips, channelNum),
    [subscribe]
  );
  const subscribeDepth = useCallback(
    (scrips, channelNum) => subscribe('dps', scrips, channelNum),
    [subscribe]
  );

  const pauseChannels = useCallback(
    (channelNums) => {
      const ws = wsRef.current;
      if (!ws) {
        addLog('Not connected.', true);
        return;
      }
      const arr = Array.isArray(channelNums) ? channelNums : [Number(channelNums)];
      ws.send(JSON.stringify({ type: 'cp', channelnums: arr }));
      addLog('Pause channels: ' + arr.join(','));
    },
    [addLog]
  );

  const resumeChannels = useCallback(
    (channelNums) => {
      const ws = wsRef.current;
      if (!ws) {
        addLog('Not connected.', true);
        return;
      }
      const arr = Array.isArray(channelNums) ? channelNums : [Number(channelNums)];
      ws.send(JSON.stringify({ type: 'cr', channelnums: arr }));
      addLog('Resume channels: ' + arr.join(','));
    },
    [addLog]
  );

  useEffect(() => () => disconnect(), [disconnect]);

  const value = {
    status,
    logs,
    chartData,
    emaSignals,
    connect,
    disconnect,
    subscribeScrips,
    subscribeIndex,
    subscribeDepth,
    pauseChannels,
    resumeChannels,
    clearLogs,
    clearChartData,
    clearCandleBuffers,
  };

  return <KotakWSContext.Provider value={value}>{children}</KotakWSContext.Provider>;
}

export function useKotakWS() {
  const ctx = useContext(KotakWSContext);
  if (!ctx) throw new Error('useKotakWS must be used within KotakWSProvider');
  return ctx;
}
