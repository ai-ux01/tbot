import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const HSM_URL = 'wss://mlhsm.kotaksecurities.com';
const THROTTLE_MS = 30000;

const KotakWSContext = createContext(null);

const CHART_DATA_MAX = 500;

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

export function KotakWSProvider({ children }) {
  const [status, setStatus] = useState('idle'); // idle | connecting | open | error | closed
  const [logs, setLogs] = useState([]);
  const [chartData, setChartData] = useState([]); // { time, value, symbol }[] for lightweight-charts
  const wsRef = useRef(null);
  const throttleRef = useRef(null);
  const sessionRef = useRef(null);

  const addLog = useCallback((line, isError = false) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-199), { ts, line, isError }]);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);
  const clearChartData = useCallback(() => setChartData([]), []);

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
    connect,
    disconnect,
    subscribeScrips,
    subscribeIndex,
    subscribeDepth,
    pauseChannels,
    resumeChannels,
    clearLogs,
    clearChartData,
  };

  return <KotakWSContext.Provider value={value}>{children}</KotakWSContext.Provider>;
}

export function useKotakWS() {
  const ctx = useContext(KotakWSContext);
  if (!ctx) throw new Error('useKotakWS must be used within KotakWSProvider');
  return ctx;
}
