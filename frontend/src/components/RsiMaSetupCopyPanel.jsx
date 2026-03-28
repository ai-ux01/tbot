import { useState, useEffect, useCallback, useMemo, useRef, useTransition } from 'react';
import {
  getRsiMaSetupCopyCombined,
  postRsiMaSetupCopyBacktest,
  getRsiMaSetupCopyBacktestCombined,
} from '../api/signals';
import {
  RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT,
  RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT,
} from '../utils/rsiMaSetupCopy';
import { getStoredCandlesLastUpdated } from '../api/kite';
import { PanelWithFullscreen } from './PanelWithFullscreen';

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
          <th>1st entry</th>
          <th>Avg entry</th>
          <th>Adds</th>
          <th>2nd entry</th>
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
            <td>
              {t.firstEntryPrice != null
                ? Number(t.firstEntryPrice).toFixed(2)
                : t.entryPrice != null
                  ? Number(t.entryPrice).toFixed(2)
                  : '—'}
            </td>
            <td>{t.entryPrice != null ? Number(t.entryPrice).toFixed(2) : '—'}</td>
            <td>{t.pyramidAdds != null ? String(t.pyramidAdds) : '—'}</td>
            <td>
              {(t.pyramidAdds ?? 0) >= 1 && t.secondEntryPrice != null
                ? Number(t.secondEntryPrice).toFixed(2)
                : '—'}
            </td>
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

export function RsiMaSetupCopyPanel() {
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
  /** Partial take-profit vs avg cost — default matches `RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PCT` (as %). */
  const [profitTargetPctInput, setProfitTargetPctInput] = useState(
    RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT,
  );
  /** Exit remainder when bar RSI ≥ this — default matches backend `RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT`. */
  const [rsiRemainderExitInput, setRsiRemainderExitInput] = useState(
    RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT,
  );
  const [backtestSeries, setBacktestSeries] = useState('day');
  const [backtestDetailCache, setBacktestDetailCache] = useState({});
  const [backtestDetailLoading, setBacktestDetailLoading] = useState({});
  const backtestDetailFetchedRef = useRef(new Set());
  const [lastUpdatedBySymbol, setLastUpdatedBySymbol] = useState({});
  const [listUiPending, startListTransition] = useTransition();
  const [mainTab, setMainTab] = useState('signals');
  /** `all` = every symbol with BUY setups + HOLD rows; `live` = BUY only when the latest daily bar is the entry bar. */
  const [signalsListMode, setSignalsListMode] = useState('all');
  const [liveBuyCount, setLiveBuyCount] = useState(null);
  const [activeFetchMode, setActiveFetchMode] = useState(null);

  const fetchSignals = useCallback(
    async (explicitMode) => {
      const mode = explicitMode !== undefined ? explicitMode : signalsListMode;
      const liveOnly = mode === 'live';
      setError(null);
      setLoading(true);
      setActiveFetchMode(mode);
      try {
        const [data, lastUpdatedRes] = await Promise.all([
          getRsiMaSetupCopyCombined(liveOnly ? { liveOnly: true } : {}),
          getStoredCandlesLastUpdated().catch(() => ({ items: [] })),
        ]);
        const map = {};
        (lastUpdatedRes.items || []).forEach((it) => {
          if (it.symbol) map[String(it.symbol)] = it.lastUpdated;
        });
        startListTransition(() => {
          if (explicitMode !== undefined) setSignalsListMode(mode);
          setSignals(Array.isArray(data.signals) ? data.signals : []);
          setCheckedCount(typeof data.checkedCount === 'number' ? data.checkedCount : null);
          setLiveBuyCount(liveOnly && typeof data.buyCount === 'number' ? data.buyCount : null);
          setLastUpdatedBySymbol(map);
        });
      } catch (e) {
        setError(e?.message ?? 'Failed to load RSI↓MA Setup (copy) signals');
        startListTransition(() => {
          setSignals([]);
          setCheckedCount(null);
          setLiveBuyCount(null);
          setLastUpdatedBySymbol({});
        });
      } finally {
        setActiveFetchMode(null);
        setLoading(false);
      }
    },
    [signalsListMode, startListTransition],
  );

  useEffect(() => {
    fetchSignals();
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
      const copyExitParams = {
        profitTargetPct: profitTargetPctInput,
        rsiRemainderExit: rsiRemainderExitInput,
      };
      if (backtestMode === 'all') {
        const data = await getRsiMaSetupCopyBacktestCombined({
          maxHoldingDays,
          series: backtestSeries,
          ...copyExitParams,
        });
        startListTransition(() => setBacktestCombinedResult(data));
      } else {
        const sym = backtestSymbol.trim();
        if (!sym) {
          setBacktestError('Enter a symbol (e.g. RELIANCE or instrument token).');
          setBacktestLoading(false);
          return;
        }
        const data = await postRsiMaSetupCopyBacktest({
          symbol: sym,
          maxHoldingDays,
          series: backtestSeries,
          ...copyExitParams,
        });
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
  }, [
    backtestMode,
    backtestSymbol,
    maxHoldingDays,
    backtestSeries,
    profitTargetPctInput,
    rsiRemainderExitInput,
    startListTransition,
  ]);

  const fetchBacktestDetailsIfNeeded = useCallback(async (symbol) => {
    const cacheKey = `${symbol}\0${backtestSeries}\0${profitTargetPctInput}\0${rsiRemainderExitInput}`;
    if (!symbol || backtestDetailFetchedRef.current.has(cacheKey)) return;
    backtestDetailFetchedRef.current.add(cacheKey);
    setBacktestDetailLoading((l) => ({ ...l, [cacheKey]: true }));
    try {
      const data = await postRsiMaSetupCopyBacktest({
        symbol,
        maxHoldingDays,
        series: backtestSeries,
        profitTargetPct: profitTargetPctInput,
        rsiRemainderExit: rsiRemainderExitInput,
      });
      startListTransition(() => setBacktestDetailCache((c) => ({ ...c, [cacheKey]: data })));
    } catch {
      backtestDetailFetchedRef.current.delete(cacheKey);
      startListTransition(() => setBacktestDetailCache((c) => ({ ...c, [cacheKey]: null })));
    } finally {
      setBacktestDetailLoading((l) => ({ ...l, [cacheKey]: false }));
    }
  }, [maxHoldingDays, backtestSeries, profitTargetPctInput, rsiRemainderExitInput, startListTransition]);

  return (
    <PanelWithFullscreen panelClassName="rsi-ma-setup-copy-panel" title="RSI↓MA Setup (copy)">
      <div
        className="rsi-ma-copy-top-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
        }}
      >
        <div
          className="dashboard-toolbar rsi-ma-copy-tablist"
          role="tablist"
          aria-label="RSI↓MA Setup copy views"
          style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 0 }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mainTab === 'signals'}
            className={mainTab === 'signals' ? 'bot-live-button' : 'btn-secondary'}
            onClick={() => setMainTab('signals')}
          >
            Signals
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mainTab === 'backtest'}
            className={mainTab === 'backtest' ? 'bot-live-button' : 'btn-secondary'}
            onClick={() => setMainTab('backtest')}
          >
            Backtest
          </button>
        </div>
        {mainTab === 'signals' && (
          <>
            <span
              className="rsi-ma-copy-top-bar-divider"
              aria-hidden
              style={{
                width: 1,
                height: 28,
                background: 'var(--border-default)',
                flexShrink: 0,
                alignSelf: 'center',
              }}
            />
            <div
              className="dashboard-toolbar rsi-ma-copy-signals-actions"
              role="group"
              aria-label="Load signals from stored daily candles"
              style={{ marginBottom: 0, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
            >
              <button
                type="button"
                className={signalsListMode === 'all' ? 'bot-live-button' : 'btn-secondary'}
                onClick={() => fetchSignals('all')}
                disabled={loading}
                title="One row per BUY setup plus a HOLD row when none (stored daily candles)"
              >
                {loading && activeFetchMode === 'all' ? 'Loading…' : 'Refresh all'}
              </button>
              <button
                type="button"
                className={signalsListMode === 'live' ? 'bot-live-button' : 'btn-secondary'}
                onClick={() => fetchSignals('live')}
                disabled={loading}
                title="Only symbols whose last daily bar is a BUY entry for this setup"
              >
                {loading && activeFetchMode === 'live' ? 'Loading…' : 'Live (last bar)'}
              </button>
            </div>
          </>
        )}
      </div>

      <div
        className="rsi-ma-copy-exit-filters"
        role="group"
        aria-label="Backtest partial take-profit and remainder RSI"
      >
        <p className="rsi-ma-copy-exit-filters-heading">Backtest exit filters</p>
        <div className="rsi-ma-copy-exit-filters-row">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span
              className="muted"
              style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}
              title={`Half position scales out at this % gain vs avg cost (default RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PCT = ${RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT}%).`}
            >
              Partial TP %
            </span>
            <input
              type="number"
              min={0.5}
              max={500}
              step={0.5}
              value={profitTargetPctInput}
              onChange={(e) => {
                const v = Number(e.target.value);
                setProfitTargetPctInput(
                  Number.isFinite(v) && v > 0 ? v : RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT,
                );
              }}
              className="bot-live-input"
              style={{ width: 80, minWidth: 72 }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className="muted" style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }} title="Exit remaining half when bar RSI ≥ this">
              Remainder RSI
            </span>
            <input
              type="number"
              min={5}
              max={95}
              step={1}
              value={rsiRemainderExitInput}
              onChange={(e) => {
                const v = Number(e.target.value);
                setRsiRemainderExitInput(
                  Number.isFinite(v)
                    ? Math.round(Math.min(95, Math.max(5, v)))
                    : RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT,
                );
              }}
              className="bot-live-input"
              style={{ width: 64, minWidth: 56 }}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            title="Reset to rsiMaSetupCopy.js defaults"
            onClick={() => {
              setProfitTargetPctInput(RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT);
              setRsiRemainderExitInput(RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT);
            }}
          >
            Reset defaults
          </button>
        </div>
        <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.75rem', lineHeight: 1.4 }}>
          Used when you run a backtest on the Backtest tab. Signals (1D) entry logic is unchanged.
        </p>
      </div>

      {mainTab === 'signals' && (
        <>
          <p className="muted" style={{ marginBottom: 16 }}>
            {signalsListMode === 'live' ? (
              <>
                Showing symbols where the <strong>latest daily candle</strong> is a copy-setup BUY (same rule as{' '}
                <code>evaluate()</code> in <code>rsiMaSetupCopy.js</code>). Not the full historical BUY list per symbol.
              </>
            ) : (
              <>
                Daily swing setup: 1D evaluation per symbol from stored candles (all qualifying setups + HOLD per symbol).
                Sync from NSE Historical Sync, then use Refresh all or Live (last bar) when you want an update—no auto-poll.
              </>
            )}
          </p>
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
                      Loading RSI↓MA Setup (copy) for symbols with stored candles…
                    </td>
                  </tr>
                ) : filteredSignals.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
                      {signals.length === 0
                        ? 'No RSI↓MA Setup (copy) signals. Sync symbols from NSE Historical Sync first, then Refresh.'
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
            {typeof checkedCount === 'number' ? ` (${checkedCount} symbols checked)` : ''}
            {signalsListMode === 'live' && liveBuyCount != null ? ` · ${liveBuyCount} live daily BUY` : ''}. Strategy logic in{' '}
            <code>rsiMaSetupCopy.js</code>.
          </p>
          {error && <p className="bot-live-error" style={{ marginTop: 8 }}>{error}</p>}
        </>
      )}

      {mainTab === 'backtest' && (
        <>
          <p className="muted" style={{ marginBottom: 16 }}>
            Historical backtest on stored candles (daily or UTC monthly aggregate). Pyramid / TP / SL in <code>rsiMaSetupCopy.js</code>.
          </p>
          <div className="dashboard-toolbar" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: '0.9rem' }}>Mode:</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" name="rsiMaCopyBacktestMode" checked={backtestMode === 'single'} onChange={() => setBacktestMode('single')} />
              <span>Single</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" name="rsiMaCopyBacktestMode" checked={backtestMode === 'all'} onChange={() => setBacktestMode('all')} />
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
              <span className="muted" style={{ fontSize: '0.85rem' }}>Bars</span>
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
              {' · '}Partial TP: <strong>{backtestCombinedResult.profitTargetPct != null ? `${(Number(backtestCombinedResult.profitTargetPct) * 100).toFixed(1)}%` : '—'}</strong>
              {' · '}Remainder RSI: <strong>{backtestCombinedResult.rsiRemainderExit ?? '—'}</strong>
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
                    const cacheKey = `${sym}\0${backtestSeries}\0${profitTargetPctInput}\0${rsiRemainderExitInput}`;
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
              {' · '}Partial TP:{' '}
              <strong>
                {backtestResult.profitTargetPct != null ? `${(Number(backtestResult.profitTargetPct) * 100).toFixed(1)}%` : '—'}
              </strong>
              {' · '}Remainder RSI: <strong>{backtestResult.rsiRemainderExit ?? '—'}</strong>
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
        </>
      )}
    </PanelWithFullscreen>
  );
}
