import { useState, useEffect, useCallback, useMemo, useRef, useTransition } from 'react';
import { getEightyPercentCombined, postEightyPercentBacktest, getEightyPercentBacktestCombined } from '../api/signals';
import { getStoredCandlesLastUpdated } from '../api/kite';
import { PanelWithFullscreen } from './PanelWithFullscreen';

const POLL_INTERVAL_MS = 60000;

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso).slice(0, 19);
  }
}

function formatLastSynced(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short' });
  } catch {
    return String(iso).slice(0, 10);
  }
}

function formatTradeTime(t) {
  if (t == null) return '—';
  const d = typeof t === 'number' ? (t < 1e10 ? new Date(t * 1000) : new Date(t)) : new Date(t);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function formatInr(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function MonthlyBreakdownTable({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return (
    <table className="dashboard-table" style={{ fontSize: '0.85rem' }}>
      <thead>
        <tr>
          <th>Month (UTC)</th>
          <th>Trades</th>
          <th>Win rate</th>
          <th>Compounded %</th>
          <th>Blended P&amp;L %</th>
          <th>Total PnL</th>
          <th>Invested Σ</th>
          <th>Avg trade %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.month}>
            <td>{row.month ?? '—'}</td>
            <td>{row.tradesCount ?? 0}</td>
            <td>{row.winRate != null ? `${(row.winRate * 100).toFixed(1)}%` : '—'}</td>
            <td
              style={{
                color: (row.compoundedReturnPercent ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)',
              }}
            >
              {row.compoundedReturnPercent != null ? `${Number(row.compoundedReturnPercent).toFixed(2)}%` : '—'}
            </td>
            <td
              style={{
                color: (row.blendedPnlPercent ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)',
              }}
            >
              {row.blendedPnlPercent != null ? `${Number(row.blendedPnlPercent).toFixed(2)}%` : '—'}
            </td>
            <td style={{ color: (row.totalPnl ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {row.totalPnl != null ? formatInr(row.totalPnl) : '—'}
            </td>
            <td>{row.totalInvested != null ? formatInr(row.totalInvested) : '—'}</td>
            <td
              style={{
                color: (row.avgTradeProfitPercent ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)',
              }}
            >
              {row.avgTradeProfitPercent != null ? `${Number(row.avgTradeProfitPercent).toFixed(2)}%` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TradeDetailsTable({ trades, barUnit = 'day' }) {
  const holdSuffix = barUnit === 'month' ? 'mo' : 'd';
  return (
    <table className="dashboard-table" style={{ fontSize: '0.85rem' }}>
      <thead>
        <tr>
          <th>Entry time</th>
          <th>First dip &lt; 40 close</th>
          <th>Entry price</th>
          <th>Exit time</th>
          <th>Exit price</th>
          <th>PnL</th>
          <th>Profit %</th>
          <th>Holding ({barUnit === 'month' ? 'mo' : 'days'})</th>
          <th>Exit reason</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t, i) => (
          <tr key={i}>
            <td>{formatTradeTime(t.entryTime)}</td>
            <td>{t.firstDipBelow40Close != null ? Number(t.firstDipBelow40Close).toFixed(2) : '—'}</td>
            <td>{t.entryPrice != null ? Number(t.entryPrice).toFixed(2) : '—'}</td>
            <td>{formatTradeTime(t.exitTime)}</td>
            <td>{t.exitPrice != null ? Number(t.exitPrice).toFixed(2) : '—'}</td>
            <td style={{ color: (t.pnl ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {t.pnl != null ? Number(t.pnl).toFixed(2) : '—'}
            </td>
            <td style={{ color: (t.profitPercent ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {t.profitPercent != null ? `${Number(t.profitPercent).toFixed(2)}%` : '—'}
            </td>
            <td>{t.holdingPeriodDays != null ? `${t.holdingPeriodDays}${holdSuffix}` : '—'}</td>
            <td>{t.exitReason ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function signalCell(sig) {
  if (sig == null) return '—';
  const color = sig === 'BUY' ? 'var(--success)' : sig === 'SELL' ? 'var(--danger)' : 'var(--text-muted)';
  return <span style={{ fontWeight: 600, color }}>{sig}</span>;
}

export function EightyPercentPanel() {
  const [signals, setSignals] = useState([]);
  const [checkedCount, setCheckedCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [signalTypeFilter, setSignalTypeFilter] = useState('BUY');
  const [backtestMode, setBacktestMode] = useState('single');
  const [backtestSymbol, setBacktestSymbol] = useState('');
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState(null);
  const [backtestResult, setBacktestResult] = useState(null);
  const [backtestCombinedResult, setBacktestCombinedResult] = useState(null);
  const [maxHoldingDays, setMaxHoldingDays] = useState(10);
  const [backtestSeries, setBacktestSeries] = useState('day');
  const [backtestDetailCache, setBacktestDetailCache] = useState({});
  const [backtestDetailLoading, setBacktestDetailLoading] = useState({});
  const backtestDetailFetchedRef = useRef(new Set());
  const [lastUpdatedBySymbol, setLastUpdatedBySymbol] = useState({});
  const [listUiPending, startListTransition] = useTransition();

  const fetchSignals = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [data, lastUpdatedRes] = await Promise.all([
        getEightyPercentCombined(),
        getStoredCandlesLastUpdated().catch(() => ({ items: [] })),
      ]);
      const map = {};
      (lastUpdatedRes.items || []).forEach((it) => {
        if (it.symbol) map[String(it.symbol)] = it.lastUpdated;
      });
      startListTransition(() => {
        setSignals(Array.isArray(data.signals) ? data.signals : []);
        setCheckedCount(typeof data.checkedCount === 'number' ? data.checkedCount : null);
        setLastUpdatedBySymbol(map);
      });
    } catch (e) {
      setError(e?.message ?? 'Failed to load RSI↓MA Setup signals');
      startListTransition(() => {
        setSignals([]);
        setCheckedCount(null);
        setLastUpdatedBySymbol({});
      });
    } finally {
      setLoading(false);
    }
  }, [startListTransition]);

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

  const runBacktest = useCallback(async () => {
    setBacktestError(null);
    setBacktestResult(null);
    setBacktestCombinedResult(null);
    setBacktestDetailCache({});
    setBacktestDetailLoading({});
    backtestDetailFetchedRef.current = new Set();
    setBacktestLoading(true);
    try {
      if (backtestMode === 'all') {
        const data = await getEightyPercentBacktestCombined({ maxHoldingDays, series: backtestSeries });
        startListTransition(() => setBacktestCombinedResult(data));
      } else {
        const sym = backtestSymbol.trim();
        if (!sym) {
          setBacktestError('Enter a symbol (e.g. RELIANCE or instrument token).');
          setBacktestLoading(false);
          return;
        }
        const data = await postEightyPercentBacktest({ symbol: sym, maxHoldingDays, series: backtestSeries });
        startListTransition(() => setBacktestResult(data));
      }
    } catch (e) {
      setBacktestError(e?.message ?? 'Backtest failed');
      startListTransition(() => {
        setBacktestResult(null);
        setBacktestCombinedResult(null);
      });
    } finally {
      setBacktestLoading(false);
    }
  }, [backtestMode, backtestSymbol, maxHoldingDays, backtestSeries, startListTransition]);

  const fetchBacktestDetailsIfNeeded = useCallback(async (symbol) => {
    const cacheKey = `${symbol}\0${backtestSeries}`;
    if (!symbol || backtestDetailFetchedRef.current.has(cacheKey)) return;
    backtestDetailFetchedRef.current.add(cacheKey);
    setBacktestDetailLoading((l) => ({ ...l, [cacheKey]: true }));
    try {
      const data = await postEightyPercentBacktest({ symbol, maxHoldingDays, series: backtestSeries });
      startListTransition(() => setBacktestDetailCache((c) => ({ ...c, [cacheKey]: data })));
    } catch {
      backtestDetailFetchedRef.current.delete(cacheKey);
      startListTransition(() => setBacktestDetailCache((c) => ({ ...c, [cacheKey]: null })));
    } finally {
      setBacktestDetailLoading((l) => ({ ...l, [cacheKey]: false }));
    }
  }, [maxHoldingDays, backtestSeries, startListTransition]);

  return (
    <PanelWithFullscreen panelClassName="eighty-percent-panel" title="RSI↓MA Setup">
      <p className="muted" style={{ marginBottom: 16 }}>
          RSI first dips below 40, then goes above 55, then BUY when RSI crosses down through RSI MA (SMA of RSI). Entry is the first dip-below-40 candle close. Backtest: 5% TP / 5% SL. Min close filter on signal bar. Live signals: 1D only. Backtest can use daily stored candles or monthly bars (UTC month from daily OHLC).
        </p>
        <div className="dashboard-toolbar" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button type="button" className="bot-live-button" onClick={fetchSignals} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <span className="muted" style={{ fontSize: '0.9rem' }}>Backtest:</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="radio" name="epBacktestMode" checked={backtestMode === 'single'} onChange={() => setBacktestMode('single')} />
            <span>Single</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="radio" name="epBacktestMode" checked={backtestMode === 'all'} onChange={() => setBacktestMode('all')} />
            <span>All</span>
          </label>
          {backtestMode === 'single' && (
            <input
              type="text"
              placeholder="Symbol (e.g. RELIANCE)"
              value={backtestSymbol}
              onChange={(e) => setBacktestSymbol(e.target.value)}
              className="bot-live-input"
              style={{ width: 140 }}
              onKeyDown={(e) => e.key === 'Enter' && runBacktest()}
            />
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="muted" style={{ fontSize: '0.85rem' }}>Backtest bars</span>
            <select
              value={backtestSeries}
              onChange={(e) => setBacktestSeries(e.target.value)}
              className="bot-live-input"
              style={{ width: 120 }}
            >
              <option value="day">Daily</option>
              <option value="month">Monthly</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="muted" style={{ fontSize: '0.85rem' }}>{backtestSeries === 'month' ? 'Max hold (months)' : 'Max hold (days)'}</span>
            <input
              type="number"
              min={1}
              step={1}
              value={maxHoldingDays}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMaxHoldingDays(Number.isFinite(v) && v >= 1 ? Math.floor(v) : 10);
              }}
              className="bot-live-input"
              style={{ width: 90 }}
            />
          </label>
          <button type="button" className="bot-live-button" onClick={runBacktest} disabled={backtestLoading}>
            {backtestLoading ? 'Running…' : 'Run backtest'}
          </button>
        </div>
        {backtestError && <p className="bot-live-error" style={{ marginBottom: 12 }}>{backtestError}</p>}
        {backtestCombinedResult && (
          <div className="dashboard-card" style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <h3 className="dashboard-card-title" style={{ fontSize: '0.95rem', marginBottom: 8 }}>
              Backtest all symbols
            </h3>
            {listUiPending && (
              <p className="muted" style={{ marginBottom: 8, fontSize: '0.8rem' }}>Finishing table render…</p>
            )}
            <p className="muted" style={{ marginBottom: 8 }}>
              Total trades: <strong>{backtestCombinedResult.summary?.totalTrades ?? 0}</strong>
              {' · '}Win rate: <strong>{(backtestCombinedResult.summary?.winRate != null ? (backtestCombinedResult.summary.winRate * 100).toFixed(1) : '—')}%</strong>
              {' · '}Total bought: <strong>{formatInr(backtestCombinedResult.summary?.totalInvestedAmount)}</strong>
              {' · '}P&L: <strong style={{ color: (backtestCombinedResult.summary?.totalPnl ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatInr(backtestCombinedResult.summary?.totalPnl)}</strong>
              {' · '}P&L %: <strong style={{ color: (backtestCombinedResult.summary?.totalPnlPercent ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{backtestCombinedResult.summary?.totalPnlPercent != null ? `${(Number(backtestCombinedResult.summary.totalPnlPercent) * 100).toFixed(2)}%` : '—'}</strong>
            </p>
            <p className="muted" style={{ marginBottom: 8, fontSize: '0.85rem' }}>
              Bar unit: <strong>{backtestCombinedResult.barUnit ?? backtestCombinedResult.summary?.barUnit ?? 'day'}</strong>
              {' · '}RSI cross bar min price (strategy): <strong>{backtestCombinedResult.summary?.minStockPrice ?? '—'}</strong>
              {' · '}Symbols checked: <strong>{backtestCombinedResult.summary?.symbolsChecked ?? '—'}</strong>
              {' · '}Backtests run: <strong>{backtestCombinedResult.summary?.symbolsProcessed ?? '—'}</strong>
              {' · '}Skipped (short history): <strong>{backtestCombinedResult.summary?.symbolsSkippedInsufficientCandles ?? '—'}</strong>
            </p>
            <div className="dashboard-table-wrap" style={{ maxHeight: 320 }}>
              <table className="dashboard-table" style={{ fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th colSpan={5} style={{ textAlign: 'left' }}>
                      <span className="backtest-combined-header-grid">
                        <span aria-hidden className="backtest-header-spacer" />
                        <span>Symbol</span>
                        <span>Trades</span>
                        <span>Win rate</span>
                        <span>Total return</span>
                        <span className="muted">Expand</span>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(backtestCombinedResult.results || []).map((r) => {
                    const sym = r.symbol;
                    const cacheKey = `${sym}\0${backtestSeries}`;
                    const detail = backtestDetailCache[cacheKey];
                    const loading = backtestDetailLoading[cacheKey];
                    const monthlyRows =
                      Array.isArray(detail?.monthlyBreakdown) && detail.monthlyBreakdown.length > 0
                        ? detail.monthlyBreakdown
                        : Array.isArray(r.monthlyBreakdown)
                          ? r.monthlyBreakdown
                          : [];
                    return (
                      <tr key={sym} className="backtest-combined-row">
                        <td colSpan={5} style={{ padding: 0, verticalAlign: 'top' }}>
                          <details
                            className="backtest-details-dropdown backtest-details-fullrow"
                            onToggle={(e) => {
                              if (e.currentTarget.open) fetchBacktestDetailsIfNeeded(sym);
                            }}
                          >
                            <summary className="backtest-details-summary-row">
                              <span className="backtest-row-chevron" aria-hidden>▶</span>
                              <span>{r.tradingsymbol || r.symbol}</span>
                              <span>{r.tradesCount ?? 0}</span>
                              <span>{r.winRate != null ? `${(r.winRate * 100).toFixed(1)}%` : '—'}</span>
                              <span style={{ color: (r.totalReturn ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                {r.totalReturn != null ? `${(r.totalReturn * 100).toFixed(2)}%` : '—'}
                              </span>
                              <span className="muted" style={{ fontWeight: 600 }}>
                                Trade details
                              </span>
                            </summary>
                            <div className="backtest-details-body">
                              {monthlyRows.length > 0 && (
                                <div style={{ marginBottom: 12 }}>
                                  <p className="muted" style={{ marginBottom: 6, fontSize: '0.8rem' }}>
                                    By exit month (UTC) — see single-symbol backtest help for metric definitions.
                                  </p>
                                  <div className="dashboard-table-wrap" style={{ maxHeight: 200 }}>
                                    <MonthlyBreakdownTable rows={monthlyRows} />
                                  </div>
                                </div>
                              )}
                              {loading ? (
                                <p className="muted" style={{ margin: 0 }}>Loading…</p>
                              ) : detail ? (
                                <>
                                  <p className="muted" style={{ marginBottom: 8, fontSize: '0.85rem' }}>
                                    Trades: <strong>{detail.tradesCount ?? 0}</strong>
                                    {' · '}Win rate: <strong>{detail.winRate != null ? `${(detail.winRate * 100).toFixed(1)}%` : '—'}</strong>
                                    {' · '}Total return: <strong style={{ color: (detail.totalReturn ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                      {detail.totalReturn != null ? `${(detail.totalReturn * 100).toFixed(2)}%` : '—'}
                                    </strong>
                                  </p>
                                  {Array.isArray(detail.trades) && detail.trades.length > 0 ? (
                                    <div className="dashboard-table-wrap" style={{ maxHeight: 260 }}>
                                      <TradeDetailsTable trades={detail.trades} barUnit={detail.barUnit ?? backtestSeries} />
                                    </div>
                                  ) : (
                                    <p className="muted" style={{ margin: 0 }}>No trades.</p>
                                  )}
                                </>
                              ) : (
                                <p className="muted" style={{ margin: 0 }}>Open to load.</p>
                              )}
                            </div>
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {backtestResult && (
          <div className="dashboard-card" style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <h3 className="dashboard-card-title" style={{ fontSize: '0.95rem', marginBottom: 8 }}>Backtest: {backtestResult.symbol}</h3>
            <p className="muted" style={{ marginBottom: 8, fontSize: '0.85rem' }}>
              Bars: <strong>{backtestResult.barUnit ?? backtestSeries}</strong>
              {(backtestResult.barUnit ?? backtestSeries) === 'month' && (
                <>
                  {' · '}Daily loaded: <strong>{backtestResult.dailyBarsUsed ?? '—'}</strong>
                  {' · '}Monthly bars: <strong>{backtestResult.monthlyBars ?? '—'}</strong>
                </>
              )}
            </p>
            <p className="muted" style={{ marginBottom: 8 }}>
              Trades: <strong>{backtestResult.tradesCount ?? 0}</strong>
              {' · '}Win rate: <strong>{backtestResult.winRate != null ? `${(backtestResult.winRate * 100).toFixed(1)}%` : '—'}</strong>
              {' · '}Total return: <strong style={{ color: (backtestResult.totalReturn ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {backtestResult.totalReturn != null ? `${(backtestResult.totalReturn * 100).toFixed(2)}%` : '—'}
              </strong>
            </p>
            {Array.isArray(backtestResult.monthlyBreakdown) && backtestResult.monthlyBreakdown.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <p className="muted" style={{ marginBottom: 8, fontSize: '0.85rem' }}>
                  <strong>By exit month (UTC)</strong> — Rows group trades by the calendar month of the exit bar.
                  Compounded % is sequential ∏(1 + PnL ÷ invested) in exit order within that month (same as the full
                  backtest when only one position is open). Blended % is ΣPnL ÷ Σinvested for the month.
                </p>
                <div className="dashboard-table-wrap" style={{ maxHeight: 240 }}>
                  <MonthlyBreakdownTable rows={backtestResult.monthlyBreakdown} />
                </div>
              </div>
            )}
            {Array.isArray(backtestResult.trades) && backtestResult.trades.length > 0 && (
              <details className="backtest-details-dropdown" style={{ marginTop: 8 }}>
                <summary
                  style={{
                    cursor: 'pointer',
                    fontWeight: 600,
                    listStyle: 'none',
                    fontSize: '0.85rem',
                    padding: '6px 0',
                  }}
                >
                  Trade details ({backtestResult.trades.length})
                </summary>
                <div className="dashboard-table-wrap" style={{ maxHeight: 260, marginTop: 8 }}>
                  <TradeDetailsTable trades={backtestResult.trades} barUnit={backtestResult.barUnit ?? backtestSeries} />
                </div>
              </details>
            )}
          </div>
        )}
        <div className="dashboard-card-header-with-filters">
          <h3 className="dashboard-card-title" style={{ marginBottom: 0 }}>Signals (1D)</h3>
          <div className="dashboard-toolbar" style={{ marginBottom: 0, flexWrap: 'wrap', gap: 8 }}>
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
              <option value="HOLD">HOLD</option>
            </select>
          </div>
        </div>
        <div className="dashboard-table-wrap" style={{ maxHeight: 480 }}>
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>RSI</th>
                <th>Signal</th>
                <th>Last synced</th>
                <th>Explain</th>
              </tr>
            </thead>
            <tbody>
              {loading && signals.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
                    Loading RSI↓MA Setup for symbols with stored candles…
                  </td>
                </tr>
              ) : filteredSignals.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
                    {signals.length === 0
                      ? 'No RSI↓MA Setup signals. Sync symbols from NSE Historical Sync first, then Refresh.'
                      : 'No matches.'}
                  </td>
                </tr>
              ) : (
                filteredSignals.map((s, i) => (
                  <tr key={`${s.tradingsymbol || s.instrument || ''}-${String(s.entryTime ?? '')}-${s.entryPrice ?? ''}-${i}`}>
                    <td style={{ verticalAlign: 'top' }}>{s.tradingsymbol || s.instrument || '—'}</td>
                    <td style={{ verticalAlign: 'top' }}>{s.rsi != null ? Number(s.rsi).toFixed(1) : '—'}</td>
                    <td style={{ verticalAlign: 'top' }}>
                      <div className="signals-stacked-cell">
                        <div>{signalCell(s.signal_type)}</div>
                        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                          {s.entryPrice != null && <span style={{ marginRight: 8 }}>Entry: {Number(s.entryPrice).toFixed(2)}</span>}
                          {s.firstDipBelow40Close != null && <span style={{ marginRight: 8 }}>First dip&lt;40: {Number(s.firstDipBelow40Close).toFixed(2)}</span>}
                          {s.entryTime && <span style={{ marginRight: 8 }}>Date: {formatTradeTime(s.entryTime)}</span>}
                          <span className="signals-stacked-label">Updated:</span> {formatTime(s.createdAt)}
                        </div>
                      </div>
                    </td>
                    <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      {formatLastSynced(lastUpdatedBySymbol[s.instrument] ?? lastUpdatedBySymbol[s.symbol])}
                    </td>
                    <td style={{ verticalAlign: 'top', maxWidth: 520 }}>
                      <span className="muted" style={{ fontSize: '0.85rem' }}>{s.explanation || '—'}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8, marginBottom: 0 }}>
          {filteredSignals.length} shown{search || signalTypeFilter !== 'all' ? ` of ${signals.length}` : ''}
          {typeof checkedCount === 'number' ? ` (${checkedCount} symbols checked)` : ''}. Symmetric 5% TP/SL backtest. 1D only. Auto-refresh every 60s.
        </p>
        {error && <p className="bot-live-error" style={{ marginTop: 8 }}>{error}</p>}
    </PanelWithFullscreen>
  );
}
