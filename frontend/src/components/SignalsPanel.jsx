import { useSignals } from '../context/SignalsContext';

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

export function SignalsPanel() {
  const {
    signals,
    loading,
    search,
    setSearch,
    signalTypeFilter,
    setSignalTypeFilter,
    filteredSignals,
  } = useSignals();

  return (
    <div className="signals-panel">
      <div className="dashboard-card">
        <div className="dashboard-card-header-with-filters">
          <h2 className="dashboard-card-title" style={{ marginBottom: 0 }}>Signals (combined 1D + 1H)</h2>
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
                    Loading…
                  </td>
                </tr>
              ) : filteredSignals.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
                    {signals.length === 0
                      ? 'No signals. Run "Run analysis on all" or Evaluate for a symbol with stored candles.'
                      : 'No matches. Try a different search or signal filter.'}
                  </td>
                </tr>
              ) : (
                filteredSignals.map((s) => (
                  <tr key={s.tradingsymbol || s.instrument || ''}>
                    <td style={{ verticalAlign: 'top' }}>
                      <div className="signals-stacked-cell">
                        <div>{s.tradingsymbol || s.instrument || '—'}</div>
                        <div style={{ marginTop: 6 }}>
                          <span
                            className={`signals-combined-btn signals-combined-btn-${(s.signal_type || 'HOLD').toLowerCase()}`}
                            role="status"
                          >
                            {s.signal_type || 'HOLD'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td style={{ verticalAlign: 'top' }}>
                      <div className="signals-stacked-cell">
                        <div>
                          <span className="signals-stacked-label">1D:</span> {signalCell(s.daySignal)}
                          <span style={{ marginLeft: 12 }}><span className="signals-stacked-label">1H:</span> {signalCell(s.hourSignal)}</span>
                        </div>
                        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                          <span className="signals-stacked-label">1D conf.</span> {s.dayConfidence != null ? `${(s.dayConfidence * 100).toFixed(0)}%` : '—'}
                          <span style={{ marginLeft: 8 }}><span className="signals-stacked-label">1H conf.</span> {s.hourConfidence != null ? `${(s.hourConfidence * 100).toFixed(0)}%` : '—'}</span>
                        </div>
                        <div className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                          <span className="signals-stacked-label">Updated:</span> {formatTime(s.createdAt)}
                        </div>
                      </div>
                    </td>
                    <td style={{ verticalAlign: 'top', maxWidth: 520 }}>
                      <div className="signals-stacked-cell">
                        <div style={{ marginBottom: 6 }}>
                          <span className="signals-stacked-label">1D:</span>
                          <span className="muted" style={{ fontSize: '0.85rem' }}> {s.dayExplanation || 'No explanation available.'}</span>
                        </div>
                        <div>
                          <span className="signals-stacked-label">1H:</span>
                          <span className="muted" style={{ fontSize: '0.85rem' }}> {s.hourExplanation || 'No explanation available.'}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8, marginBottom: 0 }}>
          {filteredSignals.length} shown{search || signalTypeFilter !== 'all' ? ` of ${signals.length}` : ''}. Combined = BUY only if both 1D and 1H BUY; SELL only if both SELL. Auto-refresh every 30s.
        </p>
      </div>
    </div>
  );
}
