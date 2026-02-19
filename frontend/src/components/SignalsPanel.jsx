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

  return (
    <div className="signals-panel" style={{ maxWidth: 900 }}>
      <h2 style={{ fontSize: '1rem', margin: '0 0 8px', color: '#e7e9ea' }}>
        AI Signals
      </h2>
      <p className="muted" style={{ fontSize: '0.85em', marginBottom: 12 }}>
        Latest signals from pattern detection + rule-based indicators. Alerts fire when signal is BUY/SELL and confidence ≥ 75%.
      </p>

      <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Filter by instrument"
          value={instrumentFilter}
          onChange={(e) => setInstrumentFilter(e.target.value)}
          className="bot-live-input"
          style={{ width: 140 }}
        />
        <select
          value={timeframeFilter}
          onChange={(e) => setTimeframeFilter(e.target.value)}
          className="bot-live-input"
          style={{ width: 100 }}
        >
          <option value="">All timeframes</option>
          <option value="day">1D</option>
          <option value="60minute">1H</option>
        </select>
        <button type="button" className="bot-live-button" onClick={fetchSignals} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: 10, background: '#1a1d21', borderRadius: 8 }}>
        <span style={{ fontSize: '0.85rem', color: '#8b98a5' }}>Evaluate:</span>
        <input
          type="text"
          placeholder="Symbol e.g. RELIANCE"
          value={evalForm.instrument}
          onChange={(e) => setEvalForm((f) => ({ ...f, instrument: e.target.value }))}
          className="bot-live-input"
          style={{ width: 140 }}
        />
        <select
          value={evalForm.timeframe}
          onChange={(e) => setEvalForm((f) => ({ ...f, timeframe: e.target.value }))}
          className="bot-live-input"
          style={{ width: 80 }}
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

      {error && <p className="bot-live-error" style={{ marginBottom: 8 }}>{error}</p>}

      <div style={{ border: '1px solid #38444d', borderRadius: 8, overflow: 'auto', maxHeight: 480 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #38444d' }}>Instrument</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #38444d' }}>Timeframe</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #38444d' }}>Signal</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid #38444d' }}>Confidence</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #38444d' }}>Pattern</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #38444d', maxWidth: 280 }}>Explanation</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #38444d' }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {loading && signals.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 16, color: '#8b98a5' }}>Loading…</td>
              </tr>
            ) : signals.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 16, color: '#8b98a5' }}>No signals. Run Evaluate for a symbol with stored candles.</td>
              </tr>
            ) : (
              signals.map((s) => (
                <tr key={s._id} style={{ borderBottom: '1px solid #2f3336' }}>
                  <td style={{ padding: '6px 10px' }}>{s.tradingsymbol || s.instrument || '—'}</td>
                  <td style={{ padding: '6px 10px' }}>{s.timeframe || '—'}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <span
                      style={{
                        fontWeight: 600,
                        color: s.signal_type === 'BUY' ? '#26a69a' : s.signal_type === 'SELL' ? '#ef5350' : '#8b98a5',
                      }}
                    >
                      {s.signal_type || 'HOLD'}
                    </span>
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {s.confidence != null ? `${(s.confidence * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', color: '#8b98a5' }}>
                    {s.pattern?.name ? `${s.pattern.name} (${(s.pattern.probability * 100 || 0).toFixed(0)}%)` : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', color: '#8b98a5', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.explanation}>
                    {s.explanation || '—'}
                  </td>
                  <td style={{ padding: '6px 10px', color: '#8b98a5', whiteSpace: 'nowrap' }}>{formatTime(s.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8 }}>
        {signals.length} signal(s). Auto-refresh every 30s. Ensure ML service is running (optional) and stored candles exist for the symbol.
      </p>
    </div>
  );
}
