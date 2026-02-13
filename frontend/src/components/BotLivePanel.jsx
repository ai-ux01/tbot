import { useState } from 'react';
import { useBotLive } from '../context/BotLiveContext';
import { useSession } from '../context/SessionContext';
import { startBot, stopBot } from '../api/bot.js';
import { SESSION_EXPIRED_CODE } from '../api/kotak';

export function BotLivePanel() {
  const { connected, livePrice, lastCandle, displayPrice, position, pnl, botStatus, lastSignal, circuitBreaker, lastTickTime } = useBotLive();
  const { session, logout } = useSession();
  const [instrumentToken, setInstrumentToken] = useState('nse_cm|11536');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleStart = async () => {
    if (!session?.sessionId) {
      setError('Login first (session required)');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await startBot({
        sessionId: session.sessionId,
        instrumentToken: instrumentToken.trim() || 'nse_cm|11536',
      });
    } catch (e) {
      if (e?.code === SESSION_EXPIRED_CODE) logout();
      setError(e?.message ?? 'Start failed');
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setError(null);
    setBusy(true);
    try {
      await stopBot();
    } catch (e) {
      setError(e?.message ?? 'Stop failed');
    } finally {
      setBusy(false);
    }
  };

  const formatPrice = (v) => (v != null && Number.isFinite(v) ? v.toFixed(2) : '–');
  const formatPnl = (v) => {
    if (v == null || !Number.isFinite(v)) return '–';
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}`;
  };

  return (
    <div className="bot-live-panel">
      <div className="bot-live-header">
        <h2>Bot live</h2>
        <span className={`bot-live-dot ${connected ? 'connected' : 'disconnected'}`} title={connected ? 'Socket connected' : 'Socket disconnected'} />
        {!connected && (
          <span className="muted" style={{ fontSize: '0.85em', marginLeft: 8 }}>
            Socket disconnected. Connection refused? Start the backend (port 4000): from project root <code>npm run backend</code> or <code>cd backend && npm run dev</code>.
          </span>
        )}
      </div>

      <p className="muted" style={{ fontSize: '0.85em', margin: '0 0 0.5rem' }}>
        Enter instrument token, then Start. Requires login. Backend must be running on port 4000.
      </p>
      <div className="bot-live-controls">
        <input
          type="text"
          value={instrumentToken}
          onChange={(e) => setInstrumentToken(e.target.value)}
          placeholder="Token (e.g. nse_cm|11536)"
          className="bot-live-input"
          aria-label="Instrument token"
        />
        <button type="button" onClick={handleStart} disabled={busy || botStatus === 'RUNNING'} className="bot-live-btn">
          Start
        </button>
        <button type="button" onClick={handleStop} disabled={busy || botStatus !== 'RUNNING'} className="bot-live-btn">
          Stop
        </button>
      </div>
      {error && <p className="bot-live-error">{error}</p>}
      {circuitBreaker && (
        <p className="bot-live-error" role="alert">
          Daily loss limit reached. Trading paused.
        </p>
      )}
      {botStatus === 'RUNNING' && displayPrice == null && (
        <p className="hint muted" style={{ marginTop: 6, fontSize: '0.8em' }}>
          {lastTickTime == null ? 'Waiting for market data. Check NSE hours (9:15–15:30 IST).' : 'Receiving ticks; price will show when LTP is available.'}
        </p>
      )}
      <dl className="bot-live-grid">
        <dt>Live price</dt>
        <dd>
          {botStatus === 'RUNNING' && displayPrice == null ? (
            <span className="muted">Waiting for ticks…</span>
          ) : (
            formatPrice(displayPrice ?? livePrice)
          )}
          {lastCandle != null && livePrice == null && displayPrice != null && (
            <span className="muted" style={{ marginLeft: 6, fontSize: '0.85em' }}> (last candle)</span>
          )}
          {botStatus === 'RUNNING' && lastTickTime != null && livePrice == null && (
            <span className="muted" style={{ display: 'block', fontSize: '0.8em', marginTop: 2 }}>Ticks received (no LTP in payload)</span>
          )}
        </dd>

        <dt>Bot status</dt>
        <dd className="bot-live-status" data-status={botStatus}>{botStatus}</dd>

        <dt>Current position</dt>
        <dd>
          {position
            ? `${position.side ?? 'LONG'} ${position.quantity ?? 0} @ ${formatPrice(position.entryPrice)}`
            : '–'}
        </dd>

        <dt>PnL</dt>
        <dd className={pnl != null && pnl < 0 ? 'negative' : ''}>{formatPnl(pnl)}</dd>

        <dt>Last signal</dt>
        <dd>
          {lastSignal
            ? `${lastSignal.signal ?? '–'} (${lastSignal.state ?? '–'}${lastSignal.strategyName ? ` · ${lastSignal.strategyName}` : ''})`
            : '–'}
        </dd>
      </dl>
    </div>
  );
}
