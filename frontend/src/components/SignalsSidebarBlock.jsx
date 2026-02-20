import { useSignals } from '../context/SignalsContext';

export function SignalsSidebarBlock() {
  const {
    loading,
    error,
    setError,
    signals,
    filteredSignals,
    buyCount,
    sellCount,
    fetchSignals,
    handleEvaluateAll,
    handleEvaluate,
    evaluating,
    evalForm,
    setEvalForm,
    evaluateAllRunning,
    evaluateAllResult,
  } = useSignals();

  return (
    <div className="signals-sidebar-block">
      <h3 className="signals-sidebar-block-title">AI Signals</h3>
      <div className="signals-sidebar-kpis">
        <div className="signals-sidebar-kpi">
          <span className="signals-sidebar-kpi-label">Showing</span>
          <span className="signals-sidebar-kpi-value">
            {loading && signals.length === 0 ? '…' : `${filteredSignals.length} / ${signals.length}`}
          </span>
        </div>
        <div className="signals-sidebar-kpi">
          <span className="signals-sidebar-kpi-label">BUY</span>
          <span className="signals-sidebar-kpi-value" style={{ color: 'var(--success)' }}>{buyCount}</span>
        </div>
        <div className="signals-sidebar-kpi">
          <span className="signals-sidebar-kpi-label">SELL</span>
          <span className="signals-sidebar-kpi-value" style={{ color: 'var(--danger)' }}>{sellCount}</span>
        </div>
      </div>
      <div className="signals-sidebar-actions">
        <button
          type="button"
          className="bot-live-button signals-sidebar-btn"
          onClick={handleEvaluateAll}
          disabled={evaluateAllRunning || loading}
          title="Run analysis on all symbols (1D + 1H)"
        >
          {evaluateAllRunning ? 'Running…' : 'Run analysis on all'}
        </button>
        <button type="button" className="btn-secondary signals-sidebar-btn signals-sidebar-refresh-btn" onClick={fetchSignals} disabled={loading} title="Refresh">
          <svg className="signals-sidebar-refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>
      {evaluateAllResult && (
        <p className="signals-sidebar-result muted">
          {evaluateAllResult.evaluated} from {evaluateAllResult.symbolCount} symbol(s).
        </p>
      )}
      <div className="signals-sidebar-eval">
        <span className="muted signals-sidebar-eval-label">Evaluate:</span>
        <input
          type="text"
          placeholder="Symbol e.g. RELIANCE"
          value={evalForm.instrument}
          onChange={(e) => setEvalForm((f) => ({ ...f, instrument: e.target.value }))}
          className="bot-live-input"
        />
        <select
          value={evalForm.timeframe}
          onChange={(e) => setEvalForm((f) => ({ ...f, timeframe: e.target.value }))}
          className="bot-live-input"
        >
          <option value="day">1D</option>
          <option value="60minute">1H</option>
        </select>
        <button
          type="button"
          className="bot-live-button signals-sidebar-btn"
          onClick={handleEvaluate}
          disabled={evaluating || !evalForm.instrument.trim()}
        >
          {evaluating ? '…' : 'Run'}
        </button>
      </div>
      {error && (
        <p className="bot-live-error signals-sidebar-error" onFocus={() => setError(null)}>
          {error}
        </p>
      )}
    </div>
  );
}
