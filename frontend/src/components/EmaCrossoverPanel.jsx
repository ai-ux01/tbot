import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getEmaCrossoverCombined, getEmaCrossoverBacktest, persistEmaCrossoverSignal } from '../api/signals';
import { useKotakWS } from '../context/KotakWSContext';
// import { KiteWebSocketPanel } from './KiteWebSocketPanel';

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

export function EmaCrossoverPanel() {
  const { status: wsStatus, emaSignals, clearCandleBuffers } = useKotakWS();
  const [signals, setSignals] = useState([]);
  const [checkedCount, setCheckedCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [signalTypeFilter, setSignalTypeFilter] = useState('BUY');
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState(null);
  const [backtestData, setBacktestData] = useState(null);
  const [backtestExpandedSymbol, setBacktestExpandedSymbol] = useState(null);
  const [backtestMinPrice, setBacktestMinPrice] = useState('');
  const [backtestMaxPrice, setBacktestMaxPrice] = useState('');
  const [backtestCapital, setBacktestCapital] = useState('10000');
  const [backtestSymbolMode, setBacktestSymbolMode] = useState('all');
  const [backtestSingleSymbol, setBacktestSingleSymbol] = useState('');
  const [backtestSortKey, setBacktestSortKey] = useState('totalPnL');
  const [backtestSortDir, setBacktestSortDir] = useState('desc');

  const emaSignalEntries = useMemo(
    () => Object.entries(emaSignals || {}).map(([symbol, s]) => ({ symbol, ...s })),
    [emaSignals]
  );

  const lastPersistedRef = useRef({});
  useEffect(() => {
    if (!emaSignals || typeof persistEmaCrossoverSignal !== 'function') return;
    for (const [symbol, s] of Object.entries(emaSignals)) {
      if (s.signal !== 'BUY' && s.signal !== 'SELL') continue;
      if (lastPersistedRef.current[symbol] === s.signal) continue;
      lastPersistedRef.current[symbol] = s.signal;
      persistEmaCrossoverSignal({
        instrument: symbol,
        tradingsymbol: symbol,
        signal_type: s.signal,
        entryPrice: s.entryPrice ?? undefined,
        explanation: s.explanation || '',
      }).catch(() => {});
    }
  }, [emaSignals]);

  const fetchSignals = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await getEmaCrossoverCombined();
      setSignals(Array.isArray(data.signals) ? data.signals : []);
      setCheckedCount(typeof data.checkedCount === 'number' ? data.checkedCount : null);
    } catch (e) {
      setError(e?.message ?? 'Failed to load EMA Crossover signals');
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

  const runBacktest = useCallback(async () => {
    setBacktestError(null);
    setBacktestLoading(true);
    try {
      const params = { timeframe: 'day' };
      if (backtestSymbolMode === 'single') {
        const sym = backtestSingleSymbol.trim();
        if (sym) params.symbol = sym;
      }
      const cap = backtestCapital.trim();
      if (cap !== '') {
        const n = parseFloat(cap);
        if (Number.isFinite(n) && n > 0) params.capital = n;
      }
      const min = backtestMinPrice.trim();
      const max = backtestMaxPrice.trim();
      if (min !== '') {
        const n = parseFloat(min);
        if (Number.isFinite(n) && n >= 0) params.minPrice = n;
      }
      if (max !== '') {
        const n = parseFloat(max);
        if (Number.isFinite(n) && n >= 0) params.maxPrice = n;
      }
      const data = await getEmaCrossoverBacktest(params);
      setBacktestData(data);
    } catch (e) {
      setBacktestError(e?.message ?? 'Backtest failed');
      setBacktestData(null);
    } finally {
      setBacktestLoading(false);
    }
  }, [backtestSymbolMode, backtestSingleSymbol, backtestCapital, backtestMinPrice, backtestMaxPrice]);

  return (
    <div className="ema-crossover-panel">
      {/* <KiteWebSocketPanel /> */}
      {/* <div className="dashboard-card" style={{ marginBottom: 24 }}>
        <h2 className="dashboard-card-title">EMA Live (WebSocket)</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Connect to Kotak WebSocket and subscribe to scrips. 1H and 1D candles are built from LTP ticks and pushed to stored historical data. EMA 10/20 runs on 1H; need ~21 completed 1H bars per symbol.
        </p>
        {wsStatus !== 'open' ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Status: <strong>{wsStatus}</strong>. Go to <strong>More</strong> → Kotak WebSocket to connect and subscribe to scrips.
          </p>
        ) : (
          <>
            <div className="dashboard-table-wrap" style={{ maxHeight: 240, marginBottom: 8 }}>
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Signal</th>
                    <th>Explain</th>
                  </tr>
                </thead>
                <tbody>
                  {emaSignalEntries.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>
                        Subscribe to scrips in More → Kotak WebSocket. After ~21 hours of ticks per symbol, EMA signal will appear here.
                      </td>
                    </tr>
                  ) : (
                    emaSignalEntries.map(({ symbol, signal, entryPrice, explanation }) => (
                      <tr key={symbol}>
                        <td>{symbol}</td>
                        <td>
                          <div>{signalCell(signal)}</div>
                          {entryPrice != null && (
                            <div className="muted" style={{ fontSize: '0.8rem' }}>Entry: {Number(entryPrice).toFixed(2)}</div>
                          )}
                        </td>
                        <td style={{ maxWidth: 400 }}>
                          <span className="muted" style={{ fontSize: '0.85rem' }}>{explanation || '—'}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {emaSignalEntries.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: '0.8rem' }}
                onClick={() => {
                  clearCandleBuffers();
                  lastPersistedRef.current = {};
                }}
              >
                Clear EMA buffers
              </button>
            )}
          </>
        )}
      </div> */}

      <div className="dashboard-card">
        <h2 className="dashboard-card-title">EMA 10 / 20 Crossover (Stored 1H)</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          BUY when EMA 10 crosses above EMA 20 and EMA 20 is above EMA 50; SELL when EMA 10 crosses below EMA 20. 1H timeframe. Uses stored candles.
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
          <h3 className="dashboard-card-title" style={{ marginBottom: 0 }}>Signals (1H)</h3>
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
                    Loading EMA Crossover for symbols with stored candles…
                  </td>
                </tr>
              ) : filteredSignals.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
                    {signals.length === 0
                      ? 'No EMA Crossover signals (1H). Sync symbols from NSE Historical Sync first, then Refresh.'
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
                          <span className="signals-stacked-label">Updated:</span> {formatTime(s.createdAt)}
                        </div>
                      </div>
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
          {typeof checkedCount === 'number' ? ` (${checkedCount} symbols checked)` : ''}. 1H only. Auto-refresh every 60s.
        </p>
        {error && <p className="bot-live-error" style={{ marginTop: 8 }}>{error}</p>}
      </div>

      <div className="dashboard-card">
        <h2 className="dashboard-card-title">Backtest: EMA 10/20 on 1D</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Run EMA 10 / EMA 20 crossover backtest (BUY only when EMA 20 &gt; EMA 50) on all stored daily candles. Optional price filter uses latest close.
        </p>
        <div className="dashboard-toolbar" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: '0.9rem' }}>Symbols:</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="backtestSymbolMode"
              checked={backtestSymbolMode === 'all'}
              onChange={() => setBacktestSymbolMode('all')}
            />
            <span>All</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="backtestSymbolMode"
              checked={backtestSymbolMode === 'single'}
              onChange={() => setBacktestSymbolMode('single')}
            />
            <span>Single</span>
          </label>
          {backtestSymbolMode === 'single' && (
            <input
              type="text"
              placeholder="Symbol or token (e.g. RELIANCE or 2881)"
              value={backtestSingleSymbol}
              onChange={(e) => setBacktestSingleSymbol(e.target.value)}
              className="bot-live-input"
              style={{ width: 180 }}
            />
          )}
          <span className="muted" style={{ fontSize: '0.9rem', marginLeft: 4 }}>Max amount:</span>
          <input
            type="number"
            placeholder="10000"
            min={1}
            step={1000}
            value={backtestCapital}
            onChange={(e) => setBacktestCapital(e.target.value)}
            className="bot-live-input"
            style={{ width: 100 }}
          />
          <span className="muted" style={{ fontSize: '0.9rem' }}>Price filter:</span>
          <input
            type="number"
            placeholder="Min price"
            min={0}
            step={0.01}
            value={backtestMinPrice}
            onChange={(e) => setBacktestMinPrice(e.target.value)}
            className="bot-live-input"
            style={{ width: 100 }}
          />
          <input
            type="number"
            placeholder="Max price"
            min={0}
            step={0.01}
            value={backtestMaxPrice}
            onChange={(e) => setBacktestMaxPrice(e.target.value)}
            className="bot-live-input"
            style={{ width: 100 }}
          />
          <button
            type="button"
            className="bot-live-button"
            onClick={runBacktest}
            disabled={backtestLoading || (backtestSymbolMode === 'single' && !backtestSingleSymbol.trim())}
          >
            {backtestLoading ? 'Running…' : backtestSymbolMode === 'single' ? 'Run backtest (1D)' : 'Run backtest on all (1D)'}
          </button>
        </div>
        {backtestError && <p className="bot-live-error" style={{ marginBottom: 8 }}>{backtestError}</p>}
        {backtestData?.summary && (
          <p className="muted" style={{ marginBottom: 12 }}>
            Capital: {backtestData.summary.capital != null ? Number(backtestData.summary.capital).toLocaleString() : '10000'} · Symbols: {backtestData.summary.totalSymbols} · Trades: {backtestData.summary.totalTrades} · Total PnL: {Number(backtestData.summary.totalPnL).toFixed(2)}
            {(backtestData.summary.minPrice != null || backtestData.summary.maxPrice != null) && (
              <> · Price: {backtestData.summary.minPrice != null ? `${backtestData.summary.minPrice} – ` : ''}{backtestData.summary.maxPrice != null ? backtestData.summary.maxPrice : '∞'}
              </>
            )}
          </p>
        )}
        {backtestData?.results?.length > 0 && (() => {
          const sortKey = backtestSortKey;
          const sortDir = backtestSortDir;
          const sortedResults = [...backtestData.results].sort((a, b) => {
            let va = a[sortKey];
            let vb = b[sortKey];
            if (sortKey === 'symbol') {
              va = (a.tradingsymbol || a.symbol || '').toLowerCase();
              vb = (b.tradingsymbol || b.symbol || '').toLowerCase();
              return sortDir === 'asc' ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);
            }
            va = Number(va);
            vb = Number(vb);
            if (!Number.isFinite(va)) va = sortKey === 'totalPnL' || sortKey === 'maxDrawdown' ? -Infinity : 0;
            if (!Number.isFinite(vb)) vb = sortKey === 'totalPnL' || sortKey === 'maxDrawdown' ? -Infinity : 0;
            return sortDir === 'asc' ? (va - vb) : (vb - va);
          });
          const handleSort = (key) => {
            setBacktestSortKey(key);
            setBacktestSortDir((d) => {
              if (key === backtestSortKey) return d === 'asc' ? 'desc' : 'asc';
              return key === 'symbol' || key === 'maxDrawdown' ? 'asc' : 'desc';
            });
          };
          const Th = ({ colKey, children }) => (
            <th
              onClick={() => handleSort(colKey)}
              style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
              title="Click to sort"
            >
              {children}
              {sortKey === colKey ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
            </th>
          );
          return (
          <div className="dashboard-table-wrap" style={{ maxHeight: 420 }}>
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <Th colKey="symbol">Symbol</Th>
                  <Th colKey="totalTrades">Trades</Th>
                  <Th colKey="winRate">Win %</Th>
                  <Th colKey="totalPnL">PnL</Th>
                  <Th colKey="maxDrawdown">Drawdown</Th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((r) => {
                  const sym = r.tradingsymbol || r.symbol;
                  const trades = Array.isArray(r.trades) ? r.trades : [];
                  const isExpanded = backtestExpandedSymbol === r.symbol;
                  return (
                    <React.Fragment key={r.symbol}>
                      <tr
                        onClick={() => trades.length > 0 && setBacktestExpandedSymbol(isExpanded ? null : r.symbol)}
                        style={{ cursor: trades.length > 0 ? 'pointer' : undefined }}
                      >
                        <td style={{ paddingRight: 0 }}>
                          {trades.length > 0 ? (
                            <span className="muted" style={{ display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                              ▶
                            </span>
                          ) : null}
                        </td>
                        <td>{sym}</td>
                        <td>{r.totalTrades ?? 0}</td>
                        <td>{r.winRate != null ? Number(r.winRate).toFixed(1) : '—'}%</td>
                        <td style={{ color: (r.totalPnL ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {r.totalPnL != null ? Number(r.totalPnL).toFixed(2) : '—'}
                        </td>
                        <td>{r.maxDrawdown != null ? Number(r.maxDrawdown).toFixed(2) : '—'}</td>
                      </tr>
                      {isExpanded && trades.length > 0 && (
                        <tr>
                          <td colSpan={6} style={{ padding: 0, verticalAlign: 'top', backgroundColor: 'var(--bg-secondary)' }}>
                            <div style={{ padding: '8px 12px', maxHeight: 200, overflow: 'auto' }}>
                              <table className="dashboard-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                  <tr>
                                    <th>Entry date</th>
                                    <th>Entry</th>
                                    <th>Exit date</th>
                                    <th>Exit</th>
                                    <th>Qty</th>
                                    <th>Holding</th>
                                    <th>PnL</th>
                                    <th>Profit %</th>
                                    <th>Exit reason</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[...trades]
                                    .sort((a, b) => {
                                      const toTs = (x) => {
                                        if (x == null) return 0;
                                        if (typeof x === 'number') return x < 1e10 ? x * 1000 : x;
                                        return new Date(x).getTime();
                                      };
                                      return toTs(b.entryTime) - toTs(a.entryTime);
                                    })
                                    .map((t, idx) => {
                                    const entryDate = t.entryTime != null ? (typeof t.entryTime === 'number' && t.entryTime < 1e10 ? new Date(t.entryTime * 1000) : new Date(t.entryTime)) : null;
                                    const exitDate = t.exitTime != null ? (typeof t.exitTime === 'number' && t.exitTime < 1e10 ? new Date(t.exitTime * 1000) : new Date(t.exitTime)) : null;
                                    const holdingStr = t.holdingTimeDays != null ? (t.holdingTimeDays >= 1 ? `${Number(t.holdingTimeDays).toFixed(1)}d` : `${(t.holdingTimeDays * 24).toFixed(1)}h`) : '—';
                                    return (
                                      <tr key={`${t.entryTime}-${idx}`}>
                                        <td>{entryDate ? entryDate.toLocaleDateString('en-IN') : '—'}</td>
                                        <td>{t.entryPrice != null ? Number(t.entryPrice).toFixed(2) : '—'}</td>
                                        <td>{exitDate ? exitDate.toLocaleDateString('en-IN') : '—'}</td>
                                        <td>{t.exitPrice != null ? Number(t.exitPrice).toFixed(2) : '—'}</td>
                                        <td>{t.quantity ?? '—'}</td>
                                        <td>{holdingStr}</td>
                                        <td style={{ color: (t.pnl ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                          {t.pnl != null ? Number(t.pnl).toFixed(2) : '—'}
                                        </td>
                                        <td style={{ color: (t.profitPercent ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                          {t.profitPercent != null ? `${Number(t.profitPercent).toFixed(2)}%` : '—'}
                                        </td>
                                        <td>{t.exitReason ?? '—'}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
