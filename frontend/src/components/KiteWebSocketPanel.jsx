import { useState, useEffect, useRef } from 'react';
import { useBotLive } from '../context/BotLiveContext';

/** Parse comma-separated instrument tokens (e.g. "408065, 884737") */
function parseTokens(input) {
  if (!input || typeof input !== 'string') return [];
  return input
    .split(/[\s,]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export function KiteWebSocketPanel() {
  const { connected, socket } = useBotLive();
  const [tokenInput, setTokenInput] = useState('408065, 884737');
  const [subscribed, setSubscribed] = useState(false);
  const [subscribeError, setSubscribeError] = useState(null);
  const [ticks, setTicks] = useState([]);
  const maxTicks = 200;
  const tickListenerRef = useRef(null);

  useEffect(() => {
    if (!socket) return;
    const handler = (data) => {
      if (!Array.isArray(data) || data.length === 0) return;
      setTicks((prev) => {
        const next = [...data.map((t) => ({ ...t, at: Date.now() })), ...prev];
        return next.slice(0, maxTicks);
      });
    };
    socket.on('kiteTick', handler);
    tickListenerRef.current = handler;
    return () => {
      socket.off('kiteTick', tickListenerRef.current);
    };
  }, [socket]);

  const handleSubscribe = () => {
    setSubscribeError(null);
    const tokens = parseTokens(tokenInput);
    if (tokens.length === 0) {
      setSubscribeError('Enter at least one instrument token (e.g. 408065, 884737).');
      return;
    }
    if (!socket?.connected) {
      setSubscribeError('Socket not connected. Wait for connection and try again.');
      return;
    }
    socket.emit('kiteWsSubscribe', { tokens }, (res) => {
      if (res?.success) {
        setSubscribed(true);
        setTicks((prev) => prev.slice(0, 0));
      } else {
        setSubscribeError(res?.error ?? 'Subscribe failed.');
      }
    });
  };

  return (
    <div className="dashboard-card" style={{ marginBottom: 24 }}>
      <h2 className="dashboard-card-title">Kite WebSocket</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Subscribe to Kite LTP via <code>wss://ws.kite.trade</code>. Uses your Kite session cookie. Enter instrument tokens (e.g. INFY 408065, TATAMOTORS 884737).
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span className="muted">
          Socket: <strong style={{ color: connected ? 'var(--success)' : 'var(--text-muted)' }}>{connected ? 'Connected' : 'Disconnected'}</strong>
        </span>
        <input
          type="text"
          placeholder="408065, 884737"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          className="bot-live-input"
          style={{ width: 220 }}
        />
        <button
          type="button"
          className="bot-live-button"
          onClick={handleSubscribe}
          disabled={!connected || !socket}
        >
          Subscribe
        </button>
      </div>
      {subscribeError && <p className="bot-live-error" style={{ marginBottom: 8 }}>{subscribeError}</p>}
      <div className="dashboard-table-wrap" style={{ maxHeight: 260 }}>
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Token</th>
              <th>LTP</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {ticks.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>
                  {subscribed ? 'Waiting for ticks…' : 'Subscribe to see live ticks.'}
                </td>
              </tr>
            ) : (
              ticks.map((t, i) => (
                <tr key={`${t.instrument_token}-${t.at}-${i}`}>
                  <td>{t.instrument_token ?? t.tk ?? '—'}</td>
                  <td>{t.ltp != null ? Number(t.ltp).toFixed(2) : t.last_price ?? '—'}</td>
                  <td className="muted" style={{ fontSize: '0.8rem' }}>
                    {t.at != null ? new Date(t.at).toLocaleTimeString('en-IN') : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
