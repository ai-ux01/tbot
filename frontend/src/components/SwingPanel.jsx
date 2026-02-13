import { useState, useEffect } from 'react';
import { useSession } from '../context/SessionContext';
import { swingStart, swingEvaluate, swingStatus, swingBacktest, swingReconcile } from '../api/swing.js';
import { SESSION_EXPIRED_CODE } from '../api/kotak';

export function SwingPanel() {
  const { session, logout } = useSession();
  const [instrumentToken, setInstrumentToken] = useState('nse_cm|2881');
  const [tradingSymbol, setTradingSymbol] = useState('RELIANCE');
  const [exchangeSegment, setExchangeSegment] = useState('nse_cm');
  const [positions, setPositions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [backtestSymbols, setBacktestSymbols] = useState('RELIANCE,TCS');
  const [backtestResult, setBacktestResult] = useState(null);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [reconcileResult, setReconcileResult] = useState(null);
  const [reconcileBusy, setReconcileBusy] = useState(false);

  const loadStatus = async () => {
    try {
      const data = await swingStatus();
      setPositions(data.positions ?? []);
    } catch (e) {
      setPositions([]);
    }
  };

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 15000);
    return () => clearInterval(t);
  }, []);

  const handleRegister = async () => {
    if (!session?.sessionId) {
      setError('Login first (session required)');
      return;
    }
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await swingStart({
        sessionId: session.sessionId,
        instrumentToken: instrumentToken.trim(),
        instrument: { exchangeSegment: exchangeSegment.trim() || 'nse_cm', tradingSymbol: tradingSymbol.trim() },
      });
      setMessage('Registered for daily swing evaluation (cron 3:45 PM IST).');
    } catch (e) {
      if (e?.code === SESSION_EXPIRED_CODE) logout();
      setError(e?.message ?? 'Register failed');
    } finally {
      setBusy(false);
    }
  };

  const handleEvaluateAll = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const data = await swingEvaluate();
      setMessage(data.message ?? 'Evaluation run for all registered instruments.');
      await loadStatus();
    } catch (e) {
      if (e?.code === SESSION_EXPIRED_CODE) logout();
      setError(e?.message ?? 'Evaluate failed');
    } finally {
      setBusy(false);
    }
  };

  const handleBacktest = async () => {
    setBacktestResult(null);
    setBacktestBusy(true);
    try {
      const symbols = backtestSymbols
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((symbol) => ({ symbol }));
      if (symbols.length === 0) {
        setError('Enter at least one symbol (comma-separated)');
        return;
      }
      const data = await swingBacktest({ symbols });
      setBacktestResult(data);
      setError(null);
    } catch (e) {
      setBacktestResult(null);
      setError(e?.message ?? 'Backtest failed');
    } finally {
      setBacktestBusy(false);
    }
  };

  const handleReconcile = async () => {
    if (!session?.sessionId) {
      setError('Login first to reconcile');
      return;
    }
    setReconcileResult(null);
    setReconcileBusy(true);
    setError(null);
    try {
      const data = await swingReconcile({ sessionId: session.sessionId });
      setReconcileResult(data);
    } catch (e) {
      if (e?.code === SESSION_EXPIRED_CODE) logout();
      setError(e?.message ?? 'Reconcile failed');
    } finally {
      setReconcileBusy(false);
    }
  };

  const formatPrice = (v) => (v != null && Number.isFinite(v) ? v.toFixed(2) : '–');
  const formatPct = (v) => (v != null && Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '–');

  return (
    <div className="bot-live-panel swing-panel">
      <p className="muted swing-intro">
        Add symbols for daily swing (EMA strategy). Evaluations run at 3:45 PM IST or when you click Run now.
      </p>

      <div className="swing-block">
        <label className="swing-label">Add symbol</label>
        <div className="bot-live-controls swing-row">
          <input
            type="text"
            value={tradingSymbol}
            onChange={(e) => setTradingSymbol(e.target.value)}
            placeholder="Symbol (e.g. RELIANCE)"
            className="bot-live-input"
            style={{ minWidth: 120 }}
            aria-label="Trading symbol"
          />
          <input
            type="text"
            value={instrumentToken}
            onChange={(e) => setInstrumentToken(e.target.value)}
            placeholder="Token (e.g. nse_cm|2881)"
            className="bot-live-input"
            style={{ minWidth: 140 }}
            aria-label="Instrument token"
          />
          <button type="button" onClick={handleRegister} disabled={busy} className="bot-live-btn">
            {busy ? '…' : 'Register'}
          </button>
        </div>
      </div>

      <div className="swing-block">
        <button type="button" onClick={handleEvaluateAll} disabled={busy} className="bot-live-btn">
          {busy ? 'Running…' : 'Run evaluation now'}
        </button>
      </div>

      {error && <p className="bot-live-error">{error}</p>}
      {message && <p className="swing-success">{message}</p>}

      <div className="swing-block">
        <span className="swing-label">Open positions</span>
        {positions.length === 0 ? (
          <p className="muted swing-positions-empty">None</p>
        ) : (
          <ul className="swing-positions-list">
            {positions.map((p) => (
              <li key={p.instrumentToken ?? p.entryDate}>
                {p.instrumentToken} — {p.quantity ?? 0} @ {formatPrice(p.entryPrice)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="swing-advanced">
        <button
          type="button"
          className="swing-advanced-toggle"
          onClick={() => setShowAdvanced(!showAdvanced)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? '▼' : '▶'} Advanced (reconcile, backtest)
        </button>
        {showAdvanced && (
          <div className="swing-advanced-content">
            <div className="swing-block">
              <span className="swing-label">Broker reconcile</span>
              <button type="button" onClick={handleReconcile} disabled={reconcileBusy || !session?.sessionId} className="bot-live-btn">
                {reconcileBusy ? '…' : 'Compare with broker'}
              </button>
              {reconcileResult && (
                <div className="swing-result">
                  {reconcileResult.error && <p className="bot-live-error">{reconcileResult.error}</p>}
                  {reconcileResult.discrepancies?.length > 0 ? (
                    <ul className="swing-positions-list">
                      {reconcileResult.discrepancies.map((d, i) => (
                        <li key={i}>{d.message ?? d.type}</li>
                      ))}
                    </ul>
                  ) : !reconcileResult.error && (
                    <p className="swing-success">No discrepancies.</p>
                  )}
                </div>
              )}
            </div>
            <div className="swing-block">
              <span className="swing-label">Backtest (needs DB data)</span>
              <div className="bot-live-controls swing-row">
                <input
                  type="text"
                  value={backtestSymbols}
                  onChange={(e) => setBacktestSymbols(e.target.value)}
                  placeholder="RELIANCE, TCS"
                  className="bot-live-input"
                  style={{ minWidth: 160 }}
                />
                <button type="button" onClick={handleBacktest} disabled={backtestBusy} className="bot-live-btn">
                  {backtestBusy ? '…' : 'Run'}
                </button>
              </div>
              {backtestResult && !backtestResult.error && (
                <dl className="swing-backtest-dl">
                  <dt>Win rate</dt><dd>{formatPct(backtestResult.winRate)}</dd>
                  <dt>Avg R</dt><dd>{backtestResult.avgR != null ? backtestResult.avgR.toFixed(2) : '–'}</dd>
                  <dt>Drawdown</dt><dd>{formatPct(backtestResult.maxDrawdown)}</dd>
                  <dt>Return</dt><dd>{formatPct(backtestResult.totalReturn)}</dd>
                  <dt>Trades</dt><dd>{backtestResult.tradesCount ?? 0}</dd>
                </dl>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
