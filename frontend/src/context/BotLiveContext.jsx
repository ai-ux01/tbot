import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { createSocketIOConnection } from '../api/socketIO.js';

const BotLiveContext = createContext(null);

function getSocketUrl() {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/kotak';
  try {
    return new URL(base).origin;
  } catch {
    return 'http://localhost:4000';
  }
}

export function BotLiveProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const [livePrice, setLivePrice] = useState(null);
  const [lastCandle, setLastCandle] = useState(null);
  const [position, setPosition] = useState(null);
  const [botStatus, setBotStatus] = useState('STOPPED');
  const [lastSignal, setLastSignal] = useState(null);
  const [circuitBreaker, setCircuitBreaker] = useState(null);
  const [lastTickTime, setLastTickTime] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const url = getSocketUrl();
    const s = createSocketIOConnection(url, { autoConnect: false });
    socketRef.current = s;
    setSocket(s);

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    s.on('tick', (data) => {
      setLastTickTime(Date.now());
      if (data?.ltp != null) setLivePrice(Number(data.ltp));
    });

    s.on('candle', (data) => {
      if (data && typeof data === 'object') setLastCandle(data);
    });

    s.on('signal', (data) => {
      setLastSignal(data ?? null);
    });

    s.on('positionUpdate', (data) => {
      const pos = data?.position ?? null;
      setPosition(pos ? { ...pos } : null);
    });

    s.on('botStatus', (data) => {
      setBotStatus(data?.status ?? 'STOPPED');
    });

    s.on('circuitBreaker', (data) => {
      setCircuitBreaker(data ?? null);
    });

    return () => {
      s.removeAllListeners();
      s.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, []);

  const displayPrice = livePrice ?? lastCandle?.close ?? null;

  const pnl = (() => {
    if (position == null || displayPrice == null) return null;
    const { quantity = 0, entryPrice = 0 } = position;
    if (quantity <= 0) return null;
    return (displayPrice - entryPrice) * quantity;
  })();

  const value = {
    connected,
    socket,
    livePrice,
    lastCandle,
    displayPrice,
    position,
    pnl,
    botStatus,
    lastSignal,
    circuitBreaker,
    lastTickTime,
  };

  return (
    <BotLiveContext.Provider value={value}>
      {children}
    </BotLiveContext.Provider>
  );
}

export function useBotLive() {
  const ctx = useContext(BotLiveContext);
  if (!ctx) throw new Error('useBotLive must be used within BotLiveProvider');
  return ctx;
}
