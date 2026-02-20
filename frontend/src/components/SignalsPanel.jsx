import { useState, useEffect, useCallback } from 'react';
import { getSignals, evaluateSignal } from '../api/signals';

const POLL_INTERVAL_MS = 30000;

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso).slice(0, 19);
  }
}

export function SignalsPanel() {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [instrumentFilter, setInstrumentFilter] = useState('');
  const [timeframeFilter, setTimeframeFilter] = useState('');
  const [evaluating, setEvaluating] = useState(null);
  const [evalForm, setEvalForm] = useState({ instrument: '', timeframe: 'day' });

  const fetchSignals = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await getSignals({
        instrument: instrumentFilter || undefined,
        timeframe: timeframeFilter || undefined,
        limit: 50,
      });
      setSignals(Array.isArray(data.signals) ? data.signals : []);
    } catch (e) {
      setError(e?.message ?? 'Failed to load signals');
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, [instrumentFilter, timeframeFilter]);

  useEffect(() => {
    fetchSignals();
    const id = setInterval(fetchSignals, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchSignals]);

  const handleEvaluate = async () => {
    const inst = (evalForm.instrument || '').trim();
    const tf = (evalForm.timeframe || 'day').trim();
    if (!inst) {
      setError('Enter instrument/symbol');
      return;
    }
    setError(null);
    setEvaluating(inst);
    try {
      await evaluateSignal({ instrument: inst, tradingsymbol: inst, timeframe: tf });
      await fetchSignals();
    } catch (e) {
      setError(e?.message ?? 'Evaluate failed');
    } finally {
      setEvaluating(null);
    }
  };

  const buyCount = signals.filter((s) => s.signal_type === 'BUY').length;
  const sellCount = signals.filter((s) => s.signal_type === 'SELL').length;

  return (
    <div className="signals-panel">
      <div className="dashboard-card">
        <h2 className="dashboard-card-title">AI Signals</h2>
        <p className="dashboard-card-subtitle">
          Latest signals from pattern detection + rule-based indicators. Alerts fire when signal is BUY/SELL and confidence ≥ 75%.
        </p>

        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Total signals</div>
            <div className="kpi-value">{loading && signals.length === 0 ? '…' : signals.length}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">BUY</div>
            <div className="kpi-value" style={{ color: 'var(--success)' }}>{buyCount}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">SELL</div>
            <div className="kpi-value" style={{ color: 'var(--danger)' }}>{sellCount}</div>
          </div>
        </div>

        <div className="dashboard-toolbar">
          <input
            type="text"
            placeholder="Filter by instrument"
            value={instrumentFilter}
            onChange={(e) => setInstrumentFilter(e.target.value)}
            className="bot-live-input"
            style={{ width: 160 }}
          />
          <select
            value={timeframeFilter}
            onChange={(e) => setTimeframeFilter(e.target.value)}
            className="bot-live-input"
            style={{ width: 120 }}
          >
            <option value="">All timeframes</option>
            <option value="day">1D</option>
            <option value="60minute">1H</option>
          </select>
          <button type="button" className="bot-live-button" onClick={fetchSignals} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        <div className="dashboard-card-inner" style={{ marginBottom: 0 }}>
          <span className="muted" style={{ marginRight: 8 }}>Evaluate:</span>
          <input
            type="text"
            placeholder="Symbol e.g. RELIANCE"
            value={evalForm.instrument}
            onChange={(e) => setEvalForm((f) => ({ ...f, instrument: e.target.value }))}
            className="bot-live-input"
            style={{ width: 160, marginRight: 8 }}
          />
          <select
            value={evalForm.timeframe}
            onChange={(e) => setEvalForm((f) => ({ ...f, timeframe: e.target.value }))}
            className="bot-live-input"
            style={{ width: 80, marginRight: 8 }}
          >
            <option value="day">1D</option>
            <option value="60minute">1H</option>
          </select>
          <button
            type="button"
            className="bot-live-button"
            onClick={handleEvaluate}
            disabled={evaluating || !evalForm.instrument.trim()}
          >
            {evaluating ? 'Running…' : 'Run'}
          </button>
        </div>

        {error && <p className="bot-live-error" style={{ marginTop: 12, marginBottom: 0 }}>{error}</p>}
      </div>

      <div className="dashboard-card">
        <h2 className="dashboard-card-title">Signals list</h2>
        <div className="dashboard-table-wrap" style={{ maxHeight: 480 }}>
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Timeframe</th>
                <th>Signal</th>
                <th style={{ textAlign: 'right' }}>Confidence</th>
                <th>Pattern</th>
                <th style={{ maxWidth: 280 }}>Explanation</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {loading && signals.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
                    Loading…
                  </td>
                </tr>
              ) : signals.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
                    No signals. Run Evaluate for a symbol with stored candles.
                  </td>
                </tr>
              ) : (
                signals.map((s) => (
                  <tr key={s._id}>
                    <td>{s.tradingsymbol || s.instrument || '—'}</td>
                    <td>{s.timeframe || '—'}</td>
                    <td>
                      <span
                        style={{
                          fontWeight: 600,
                          color:
                            s.signal_type === 'BUY'
                              ? 'var(--success)'
                              : s.signal_type === 'SELL'
                                ? 'var(--danger)'
                                : 'var(--text-muted)',
                        }}
                      >
                        {s.signal_type || 'HOLD'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {s.confidence != null ? `${(s.confidence * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {s.pattern?.name
                        ? `${s.pattern.name} (${(s.pattern.probability * 100 || 0).toFixed(0)}%)`
                        : '—'}
                    </td>
                    <td
                      style={{
                        color: 'var(--text-muted)',
                        maxWidth: 280,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={s.explanation}
                    >
                      {s.explanation || '—'}
                    </td>
                    <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {formatTime(s.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8, marginBottom: 0 }}>
          {signals.length} signal(s). Auto-refresh every 30s. Ensure ML service is running (optional) and stored candles exist.
        </p>
      </div>
    </div>
  );
}
