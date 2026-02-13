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
    const socket = createSocketIOConnection(url, { autoConnect: true });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('tick', (data) => {
      setLastTickTime(Date.now());
      if (data?.ltp != null) setLivePrice(Number(data.ltp));
    });

    socket.on('candle', (data) => {
      if (data && typeof data === 'object') setLastCandle(data);
    });

    socket.on('signal', (data) => {
      setLastSignal(data ?? null);
    });

    socket.on('positionUpdate', (data) => {
      const pos = data?.position ?? null;
      setPosition(pos ? { ...pos } : null);
    });

    socket.on('botStatus', (data) => {
      setBotStatus(data?.status ?? 'STOPPED');
    });

    socket.on('circuitBreaker', (data) => {
      setCircuitBreaker(data ?? null);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
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
