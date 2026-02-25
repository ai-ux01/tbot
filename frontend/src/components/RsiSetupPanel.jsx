import { useState, useEffect, useCallback, useMemo } from 'react';
import { getRsiSetupCombined } from '../api/signals';

const POLL_INTERVAL_MS = 60000;

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso).slice(0, 19);
  }
}

function signalCell(sig) {
  if (sig == null) return '—';
  const color = sig === 'BUY' ? 'var(--success)' : sig === 'SELL' ? 'var(--danger)' : 'var(--text-muted)';
  return <span style={{ fontWeight: 600, color }}>{sig}</span>;
}

export function RsiSetupPanel() {
  const [signals, setSignals] = useState([]);
  const [checkedCount, setCheckedCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [signalTypeFilter, setSignalTypeFilter] = useState('BUY');

  const fetchSignals = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await getRsiSetupCombined();
      setSignals(Array.isArray(data.signals) ? data.signals : []);
      setCheckedCount(typeof data.checkedCount === 'number' ? data.checkedCount : null);
    } catch (e) {
      setError(e?.message ?? 'Failed to load RSI Setup signals');
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals();
    const id = setInterval(fetchSignals, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchSignals]);

  const filteredSignals = useMemo(() => {
    const searchLower = search.trim().toLowerCase();
    return signals.filter((s) => {
      const matchType = signalTypeFilter === 'all' || (s.signal_type || 'HOLD') === signalTypeFilter;
      const matchSearch = !searchLower || [s.instrument, s.tradingsymbol].some(
        (v) => String(v || '').toLowerCase().includes(searchLower)
      );
      return matchType && matchSearch;
    });
  }, [signals, search, signalTypeFilter]);

  return (
    <div className="rsi-setup-panel">
      <div className="dashboard-card">
        <h2 className="dashboard-card-title">RSI Setup</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          RSI momentum reset: peak ≥70 → Low1 (35–45) → rebound (55–65) → second pullback. Entry when close ≈ low1_price (0.5% tol), RSI 35–45, RSI turning up, RSI touches/crosses below RSI SMA. Confidence: LOW/MEDIUM/HIGH. 1D only.
        </p>
        <div className="dashboard-toolbar" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className="bot-live-button"
            onClick={fetchSignals}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <div className="dashboard-card-header-with-filters">
          <h3 className="dashboard-card-title" style={{ marginBottom: 0 }}>Signals (1D)</h3>
          <div className="dashboard-toolbar" style={{ marginBottom: 0, flexWrap: 'nowrap' }}>
            <input
              type="text"
              placeholder="Search instrument…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bot-live-input"
              style={{ width: 160 }}
            />
            <span className="signals-stacked-label" style={{ marginRight: 4 }}>Signal:</span>
            <select
              value={signalTypeFilter}
              onChange={(e) => setSignalTypeFilter(e.target.value)}
              className="bot-live-input"
              style={{ width: 90 }}
            >
              <option value="all">All</option>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
              <option value="HOLD">HOLD</option>
            </select>
          </div>
        </div>
        <div className="dashboard-table-wrap" style={{ maxHeight: 480 }}>
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Signal</th>
                <th>Explain</th>
              </tr>
            </thead>
            <tbody>
              {loading && signals.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
                    Loading RSI Setup for symbols with stored candles…
                  </td>
                </tr>
              ) : filteredSignals.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
                    {signals.length === 0
                      ? 'No RSI Setup signals. Sync symbols from NSE Historical Sync first, then Refresh.'
                      : 'No matches. Try a different search or signal filter.'}
                  </td>
                </tr>
              ) : (
                filteredSignals.map((s) => (
                  <tr key={s.tradingsymbol || s.instrument || ''}>
                    <td style={{ verticalAlign: 'top' }}>
                      {s.tradingsymbol || s.instrument || '—'}
                    </td>
                    <td style={{ verticalAlign: 'top' }}>
                      <div className="signals-stacked-cell">
                        <div>{signalCell(s.signal_type)}</div>
                        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                          {s.entryPrice != null && (
                            <span style={{ marginRight: 8 }}>Entry: {Number(s.entryPrice).toFixed(2)}</span>
                          )}
                          {s.confidenceLabel && (
                            <span style={{ marginRight: 8 }}>{s.confidenceLabel}</span>
                          )}
                          {s.confidenceScore != null && (
                            <span style={{ marginRight: 8 }}>({s.confidenceScore})</span>
                          )}
                          <span className="signals-stacked-label">Updated:</span> {formatTime(s.createdAt)}
                        </div>
                      </div>
                    </td>
                    <td style={{ verticalAlign: 'top', maxWidth: 520 }}>
                      <span className="muted" style={{ fontSize: '0.85rem' }}>{s.explanation || 'No explanation available.'}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8, marginBottom: 0 }}>
          {filteredSignals.length} shown{search || signalTypeFilter !== 'all' ? ` of ${signals.length}` : ''}
          {typeof checkedCount === 'number' ? ` (${checkedCount} symbols checked)` : ''}. 1D only. Auto-refresh every 60s.
        </p>
        {error && <p className="bot-live-error" style={{ marginTop: 8 }}>{error}</p>}
      </div>
    </div>
  );
}
