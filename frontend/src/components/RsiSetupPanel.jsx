import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { getRsiSetupCombined, postRsiSetupBacktest, getRsiSetupBacktestCombined } from '../api/signals';
import { getStoredCandlesLastUpdated } from '../api/kite';

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

function formatBacktestPriceRange(minP, maxP) {
  if (minP == null && maxP == null) return 'None';
  if (minP != null && maxP != null) return `${minP} – ${maxP}`;
  if (minP != null) return `≥ ${minP}`;
  return `≤ ${maxP}`;
}

function formatRsiBacktestExitReason(t) {
  const pct =
    t.positionFraction != null && t.positionFraction < 0.999
      ? `${Math.round(t.positionFraction * 100)}% size · `
      : '';
  switch (t.exitReason) {
    case 'stop_pullback_low':
      return 'Stop (3% below pullback low)';
    case 'rebound_partial_70':
      return '70% @ rebound (day high)';
    case 'setup_complete':
      return `${pct}RSI ≥ 70 (setup complete)`;
    case 'max_holding':
      return `${pct}Max holding`;
    case 'eod':
      return `${pct}End of data`;
    default:
      return t.exitReason ?? '—';
  }
}

function TradeDetailsTable({ trades }) {
  const colCount = 9;
  return (
    <table className="dashboard-table rsi-setup-trade-details-table" style={{ fontSize: '0.85rem' }}>
      <thead>
        <tr>
          <th>Entry time</th>
          <th>Entry price</th>
          <th>Exit time</th>
          <th>Exit price</th>
          <th>Confidence</th>
          <th>PnL</th>
          <th>Profit %</th>
          <th>Holding</th>
          <th>Exit reason</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t, i) => (
          <Fragment key={i}>
            <tr>
              <td>{formatTradeTime(t.entryTime)}</td>
              <td>{t.entryPrice != null ? Number(t.entryPrice).toFixed(2) : '—'}</td>
              <td>{formatTradeTime(t.exitTime)}</td>
              <td>{t.exitPrice != null ? Number(t.exitPrice).toFixed(2) : '—'}</td>
              <td>
                {t.confidenceLabel
                  ? `${t.confidenceLabel}${t.confidenceScore != null ? ` (${Number(t.confidenceScore).toFixed(0)})` : ''}`
                  : '—'}
              </td>
              <td style={{ color: (t.pnl ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {t.pnl != null ? Number(t.pnl).toFixed(2) : '—'}
              </td>
              <td style={{ color: (t.profitPercent ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {t.profitPercent != null ? `${Number(t.profitPercent).toFixed(2)}%` : '—'}
              </td>
              <td>{t.holdingPeriodDays != null ? `${t.holdingPeriodDays}d` : '—'}</td>
              <td>{formatRsiBacktestExitReason(t)}</td>
            </tr>
            {t.explanation ? (
              <tr className="rsi-setup-trade-explain-row">
                <td colSpan={colCount} style={{ paddingTop: 4, paddingBottom: 12 }}>
                  <div className="rsi-setup-explain-text rsi-setup-trade-explain-inner">{t.explanation}</div>
                </td>
              </tr>
            ) : null}
          </Fragment>
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

export function RsiSetupPanel() {
  const [rsiSetupMode, setRsiSetupMode] = useState('strict');
  const [low1MinInput, setLow1MinInput] = useState('');
  const [low1MaxInput, setLow1MaxInput] = useState('');
  const [reboundMinInput, setReboundMinInput] = useState('');
  const [reboundMaxInput, setReboundMaxInput] = useState('');
  const [signals, setSignals] = useState([]);
  const [checkedCount, setCheckedCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [signalTypeFilter, setSignalTypeFilter] = useState('BUY');
  const [rsiFilterMin, setRsiFilterMin] = useState(0);
  const [rsiFilterMax, setRsiFilterMax] = useState(100);
  const [backtestMode, setBacktestMode] = useState('single');
  const [backtestSymbol, setBacktestSymbol] = useState('');
  /** Empty = no cap; else max bars in trade (1D) before forced exit at close */
  const [backtestMaxHoldingDays, setBacktestMaxHoldingDays] = useState('');
  /** Last daily close must fall in [min, max] when set (backtest only) */
  const [backtestMinPrice, setBacktestMinPrice] = useState('');
  const [backtestMaxPrice, setBacktestMaxPrice] = useState('');
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState(null);
  const [backtestResult, setBacktestResult] = useState(null);
  const [backtestCombinedResult, setBacktestCombinedResult] = useState(null);
  const [backtestDetailCache, setBacktestDetailCache] = useState({});
  const [backtestDetailLoading, setBacktestDetailLoading] = useState({});
  const backtestDetailFetchedRef = useRef(new Set());
  const [lastUpdatedBySymbol, setLastUpdatedBySymbol] = useState({});

  const rsiBandFilter = useMemo(() => {
    const parse = (v) => {
      const s = String(v ?? '').trim();
      if (!s) return undefined;
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    };
    const low1Min = parse(low1MinInput);
    const low1Max = parse(low1MaxInput);
    const reboundMin = parse(reboundMinInput);
    const reboundMax = parse(reboundMaxInput);
    if ([low1Min, low1Max, reboundMin, reboundMax].some((v) => Number.isNaN(v))) {
      return { invalid: true, api: {} };
    }
    if (low1Min != null && low1Max != null && low1Min > low1Max) return { invalid: true, api: {} };
    if (reboundMin != null && reboundMax != null && reboundMin > reboundMax) return { invalid: true, api: {} };
    return {
      invalid: false,
      api: {
        ...(low1Min != null ? { low1Min } : {}),
        ...(low1Max != null ? { low1Max } : {}),
        ...(reboundMin != null ? { reboundMin } : {}),
        ...(reboundMax != null ? { reboundMax } : {}),
      },
    };
  }, [low1MinInput, low1MaxInput, reboundMinInput, reboundMaxInput]);

  const fetchSignals = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [data, lastUpdatedRes] = await Promise.all([getRsiSetupCombined({ mode: rsiSetupMode, ...rsiBandFilter.api }), getStoredCandlesLastUpdated().catch(() => ({ items: [] }))]);
      setSignals(Array.isArray(data.signals) ? data.signals : []);
      setCheckedCount(typeof data.checkedCount === 'number' ? data.checkedCount : null);
      const map = {};
      (lastUpdatedRes.items || []).forEach((it) => {
        if (it.symbol) map[String(it.symbol)] = it.lastUpdated;
      });
      setLastUpdatedBySymbol(map);
    } catch (e) {
      setError(e?.message ?? 'Failed to load RSI Setup signals');
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, [rsiSetupMode, rsiBandFilter.api]);

  useEffect(() => {
    fetchSignals();
    const id = setInterval(fetchSignals, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchSignals]);

  const filteredSignals = useMemo(() => {
    const searchLower = search.trim().toLowerCase();
    const minRsi = rsiFilterMin === '' || rsiFilterMin == null ? NaN : Number(rsiFilterMin);
    const maxRsi = rsiFilterMax === '' || rsiFilterMax == null ? NaN : Number(rsiFilterMax);
    const hasRsiRange = Number.isFinite(minRsi) && Number.isFinite(maxRsi) && minRsi <= maxRsi;
    return signals.filter((s) => {
      const matchType = signalTypeFilter === 'all' || (s.signal_type || 'HOLD') === signalTypeFilter;
      const matchSearch = !searchLower || [s.instrument, s.tradingsymbol].some(
        (v) => String(v || '').toLowerCase().includes(searchLower)
      );
      const matchRsi = !hasRsiRange || (s.rsi != null && s.rsi >= minRsi && s.rsi <= maxRsi);
      return matchType && matchSearch && matchRsi;
    });
  }, [signals, search, signalTypeFilter, rsiFilterMin, rsiFilterMax]);

  const backtestMaxHoldingPayload = useMemo(() => {
    const v = String(backtestMaxHoldingDays).trim();
    if (v === '') return { key: 'none', api: undefined };
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < 1 || n > 3650) return { key: 'invalid', api: undefined };
    return { key: String(n), api: n };
  }, [backtestMaxHoldingDays]);

  const backtestPriceFilterPayload = useMemo(() => {
    const minS = String(backtestMinPrice).trim();
    const maxS = String(backtestMaxPrice).trim();
    if (minS === '' && maxS === '') return { key: 'none', min: undefined, max: undefined };
    const minN = minS === '' ? null : Number(minS);
    const maxN = maxS === '' ? null : Number(maxS);
    if (minS !== '' && (!Number.isFinite(minN) || minN < 0)) return { key: 'invalid', min: undefined, max: undefined };
    if (maxS !== '' && (!Number.isFinite(maxN) || maxN < 0)) return { key: 'invalid', min: undefined, max: undefined };
    if (minN != null && maxN != null && minN > maxN) return { key: 'invalid', min: undefined, max: undefined };
    return {
      key: `${minN ?? 'x'}_${maxN ?? 'x'}`,
      min: minN ?? undefined,
      max: maxN ?? undefined,
    };
  }, [backtestMinPrice, backtestMaxPrice]);

  const runBacktest = useCallback(async () => {
    setBacktestError(null);
    setBacktestResult(null);
    setBacktestCombinedResult(null);
    setBacktestDetailCache({});
    setBacktestDetailLoading({});
    backtestDetailFetchedRef.current = new Set();
    if (backtestMaxHoldingPayload.key === 'invalid') {
      setBacktestError('Max holding must be blank or 1–3650 daily bars.');
      return;
    }
    if (backtestPriceFilterPayload.key === 'invalid') {
      setBacktestError('Price filter: enter non‑negative min/max or leave blank; min ≤ max.');
      return;
    }
    if (rsiBandFilter.invalid) {
      setBacktestError('RSI band filter invalid. Ensure min ≤ max and numeric values.');
      return;
    }
    setBacktestLoading(true);
    try {
      const mh = backtestMaxHoldingPayload.api;
      const pf = backtestPriceFilterPayload;
      const backtestOpts = {
        mode: rsiSetupMode,
        ...rsiBandFilter.api,
        ...(mh != null ? { maxHoldingDays: mh } : {}),
        ...(pf.min != null ? { minPrice: pf.min } : {}),
        ...(pf.max != null ? { maxPrice: pf.max } : {}),
      };
      if (backtestMode === 'all') {
        const data = await getRsiSetupBacktestCombined(backtestOpts);
        setBacktestCombinedResult(data);
      } else {
        const sym = backtestSymbol.trim();
        if (!sym) {
          setBacktestError('Enter a symbol (e.g. RELIANCE or instrument token).');
          setBacktestLoading(false);
          return;
        }
        const data = await postRsiSetupBacktest({ symbol: sym, ...backtestOpts });
        setBacktestResult(data);
      }
    } catch (e) {
      setBacktestError(e?.message ?? 'Backtest failed');
      setBacktestResult(null);
      setBacktestCombinedResult(null);
    } finally {
      setBacktestLoading(false);
    }
  }, [backtestMode, backtestSymbol, backtestMaxHoldingPayload, backtestPriceFilterPayload, rsiSetupMode, rsiBandFilter]);

  const backtestDetailCacheKey = useCallback(
    (symbol) =>
      `${symbol}::${rsiSetupMode}::${JSON.stringify(rsiBandFilter.api)}::${backtestMaxHoldingPayload.key}::${backtestPriceFilterPayload.key}`,
    [rsiSetupMode, rsiBandFilter.api, backtestMaxHoldingPayload.key, backtestPriceFilterPayload.key]
  );

  const fetchBacktestDetailsIfNeeded = useCallback(
    async (symbol) => {
      if (backtestMaxHoldingPayload.key === 'invalid' || backtestPriceFilterPayload.key === 'invalid' || !symbol) return;
      if (rsiBandFilter.invalid) return;
      const cacheKey = backtestDetailCacheKey(symbol);
      if (backtestDetailFetchedRef.current.has(cacheKey)) return;
      backtestDetailFetchedRef.current.add(cacheKey);
      setBacktestDetailLoading((l) => ({ ...l, [cacheKey]: true }));
      try {
        const mh = backtestMaxHoldingPayload.api;
        const pf = backtestPriceFilterPayload;
        const data = await postRsiSetupBacktest({
          symbol,
          mode: rsiSetupMode,
          ...rsiBandFilter.api,
          ...(mh != null ? { maxHoldingDays: mh } : {}),
          ...(pf.min != null ? { minPrice: pf.min } : {}),
          ...(pf.max != null ? { maxPrice: pf.max } : {}),
        });
        setBacktestDetailCache((c) => ({ ...c, [cacheKey]: data }));
      } catch {
        backtestDetailFetchedRef.current.delete(cacheKey);
        setBacktestDetailCache((c) => ({ ...c, [cacheKey]: null }));
      } finally {
        setBacktestDetailLoading((l) => ({ ...l, [cacheKey]: false }));
      }
    },
    [backtestMaxHoldingPayload, backtestPriceFilterPayload, backtestDetailCacheKey, rsiSetupMode, rsiBandFilter]
  );

  const backtestCombinedRowsWithTrades = useMemo(() => {
    const all = backtestCombinedResult?.results;
    if (!Array.isArray(all)) return [];
    return all.filter((r) => (r.tradesCount ?? 0) > 0);
  }, [backtestCombinedResult]);

  const backtestCombinedHiddenZeroTrades = useMemo(() => {
    const all = backtestCombinedResult?.results;
    if (!Array.isArray(all)) return 0;
    return all.filter((r) => (r.tradesCount ?? 0) === 0).length;
  }, [backtestCombinedResult]);

  return (
    <div className="rsi-setup-panel">
      <div className="dashboard-card">
        <h2 className="dashboard-card-title">RSI Setup</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Each signal lists prices at each step: Peak ≥70 → Low1 (below 45) → lowest price before rebound (above 55) → Rebound → RSI near or crosses RSI SMA (looser band vs MA) while the RSI moving average is rising. Entry when close ≈ low1_price (0.5% tol). Live idea: exit when RSI touches 70 again. Backtest: stop if low ≤ pullback low before rebound minus 3%; take 70% when high ≥ rebound day high; runner exits on RSI ≥ 70, max hold, or end of data. 1D only.
        </p>
        <div className="dashboard-toolbar" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="muted" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Mode:</span>
            <select
              value={rsiSetupMode}
              onChange={(e) => setRsiSetupMode(e.target.value === 'lenient' ? 'lenient' : 'strict')}
              className="bot-live-input"
              style={{ width: 110 }}
            >
              <option value="strict">Strict</option>
              <option value="lenient">Lenient</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="muted" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Low1</span>
            <input type="text" value={low1MinInput} onChange={(e) => setLow1MinInput(e.target.value.replace(/[^\d.]/g, ''))} className="bot-live-input" style={{ width: 56 }} placeholder="min" />
            <span className="muted">-</span>
            <input type="text" value={low1MaxInput} onChange={(e) => setLow1MaxInput(e.target.value.replace(/[^\d.]/g, ''))} className="bot-live-input" style={{ width: 56 }} placeholder="max" />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="muted" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Rebound</span>
            <input type="text" value={reboundMinInput} onChange={(e) => setReboundMinInput(e.target.value.replace(/[^\d.]/g, ''))} className="bot-live-input" style={{ width: 56 }} placeholder="min" />
            <span className="muted">-</span>
            <input type="text" value={reboundMaxInput} onChange={(e) => setReboundMaxInput(e.target.value.replace(/[^\d.]/g, ''))} className="bot-live-input" style={{ width: 56 }} placeholder="max" />
          </label>
          <button
            type="button"
            className="bot-live-button"
            onClick={fetchSignals}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <div className="rsi-setup-backtest-controls">
          <p className="rsi-setup-backtest-controls-title">Backtest</p>
          <div className="rsi-setup-backtest-controls-row">
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px' }}>
              <span className="muted" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Scope:</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="rsiBacktestMode" checked={backtestMode === 'single'} onChange={() => setBacktestMode('single')} />
                <span>Single symbol</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="rsiBacktestMode" checked={backtestMode === 'all'} onChange={() => setBacktestMode('all')} />
                <span>All stored</span>
              </label>
            </div>
            <div className="rsi-setup-maxhold-field">
              <label htmlFor="rsi-backtest-max-hold">Max holding (1D bars)</label>
              <input
                id="rsi-backtest-max-hold"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. 30 — empty = no limit"
                value={backtestMaxHoldingDays}
                onChange={(e) => setBacktestMaxHoldingDays(e.target.value.replace(/\D/g, ''))}
                className="bot-live-input"
                style={{ width: 'min(100%, 11rem)' }}
                title="Exit at close after this many daily bars in the trade. RSI ≥ 70 still exits first on that bar."
              />
              <span className="muted rsi-setup-maxhold-hint">
                Caps time in trade. Leave empty to exit only on RSI ≥ 70 or end of data.
              </span>
            </div>
            <div className="rsi-setup-maxhold-field">
              <label htmlFor="rsi-backtest-min-price">Min price (last close)</label>
              <input
                id="rsi-backtest-min-price"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="No min"
                value={backtestMinPrice}
                onChange={(e) => setBacktestMinPrice(e.target.value.replace(/[^\d.]/g, ''))}
                className="bot-live-input"
                style={{ width: 'min(100%, 8rem)' }}
                title="Include symbols only if last daily close ≥ this. Leave blank for no minimum."
              />
              <label htmlFor="rsi-backtest-max-price" style={{ marginTop: 8 }}>
                Max price (last close)
              </label>
              <input
                id="rsi-backtest-max-price"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="No max"
                value={backtestMaxPrice}
                onChange={(e) => setBacktestMaxPrice(e.target.value.replace(/[^\d.]/g, ''))}
                className="bot-live-input"
                style={{ width: 'min(100%, 8rem)' }}
                title="Include symbols only if last daily close ≤ this. Leave blank for no maximum."
              />
              <span className="muted rsi-setup-maxhold-hint">
                Filters by latest stored daily close. Single-symbol run errors if outside range.
              </span>
            </div>
            {backtestMode === 'single' && (
              <div className="rsi-setup-maxhold-field">
                <label htmlFor="rsi-backtest-symbol">Symbol</label>
                <input
                  id="rsi-backtest-symbol"
                  type="text"
                  placeholder="e.g. RELIANCE"
                  value={backtestSymbol}
                  onChange={(e) => setBacktestSymbol(e.target.value)}
                  className="bot-live-input"
                  style={{ width: 'min(100%, 11rem)' }}
                  onKeyDown={(e) => e.key === 'Enter' && runBacktest()}
                />
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
              <button
                type="button"
                className="bot-live-button"
                onClick={runBacktest}
                disabled={backtestLoading || (backtestMode === 'single' && !backtestSymbol.trim())}
              >
                {backtestLoading ? 'Running…' : backtestMode === 'all' ? 'Run backtest on all' : 'Run backtest'}
              </button>
            </div>
          </div>
        </div>
        {backtestError && <p className="bot-live-error" style={{ marginBottom: 12 }}>{backtestError}</p>}
        {backtestCombinedResult && (
          <div className="dashboard-card" style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <h3 className="dashboard-card-title" style={{ fontSize: '0.95rem', marginBottom: 8 }}>Backtest (all stored)</h3>
            <div className="rsi-setup-backtest-filter-badge" role="status">
              <span className="muted" style={{ fontWeight: 600 }}>Active filter</span>
              <span>
                Mode:{' '}
                <strong>{String(backtestCombinedResult.mode || rsiSetupMode).toUpperCase()}</strong>
              </span>
              <span>
                Max holding:{' '}
                <strong>
                  {backtestCombinedResult.maxHoldingDays != null
                    ? `${backtestCombinedResult.maxHoldingDays} daily bar${backtestCombinedResult.maxHoldingDays === 1 ? '' : 's'}`
                    : 'None (unlimited)'}
                </strong>
              </span>
              <span>
                Price (last close):{' '}
                <strong>
                  {formatBacktestPriceRange(backtestCombinedResult.minPrice, backtestCombinedResult.maxPrice)}
                </strong>
              </span>
            </div>
            {backtestCombinedResult.summary && (
              <p className="muted" style={{ marginBottom: 12 }}>
                Symbols: <strong>{backtestCombinedResult.summary.totalSymbols ?? 0}</strong>
                {typeof backtestCombinedResult.summary.priceFilteredOut === 'number' &&
                backtestCombinedResult.summary.priceFilteredOut > 0 ? (
                  <>
                    {' · '}
                    Skipped (price): <strong>{backtestCombinedResult.summary.priceFilteredOut}</strong>
                  </>
                ) : null}
                {' · '}Total trades: <strong>{backtestCombinedResult.summary.totalTrades ?? 0}</strong>
                {' · '}Avg win rate: <strong>{(Number(backtestCombinedResult.summary.avgWinRate ?? 0) * 100).toFixed(1)}%</strong>
              </p>
            )}
            {Array.isArray(backtestCombinedResult.results) && backtestCombinedResult.results.length > 0 && (
              <>
                {backtestCombinedRowsWithTrades.length === 0 ? (
                  <p className="muted" style={{ marginBottom: 0, fontSize: '0.9rem' }}>
                    No symbols with trades — rows with 0 trades are hidden (
                    {backtestCombinedResult.results.length} symbol
                    {backtestCombinedResult.results.length === 1 ? '' : 's'} checked).
                  </p>
                ) : (
                <div className="dashboard-table-wrap" style={{ maxHeight: 320 }}>
                  <table className="dashboard-table" style={{ fontSize: '0.85rem' }}>
                    <thead>
                      <tr>
                        <th colSpan={6} style={{ textAlign: 'left' }}>
                          <span className="backtest-combined-header-grid">
                            <span aria-hidden className="backtest-header-spacer" />
                            <span>Symbol</span>
                            <span className="backtest-col-current-price">Current price</span>
                            <span>Trades</span>
                            <span>Win rate</span>
                            <span>Total return</span>
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {backtestCombinedRowsWithTrades.map((r) => {
                        const sym = r.symbol;
                        const detailKey = backtestDetailCacheKey(sym);
                        const detail = backtestDetailCache[detailKey];
                        const loading = backtestDetailLoading[detailKey];
                        return (
                          <tr key={sym} className="backtest-combined-row">
                            <td colSpan={6} style={{ padding: 0, verticalAlign: 'top' }}>
                              <details
                                className="backtest-details-dropdown backtest-details-fullrow"
                                onToggle={(e) => {
                                  if (e.currentTarget.open) fetchBacktestDetailsIfNeeded(sym);
                                }}
                              >
                                <summary className="backtest-details-summary-row">
                                  <span className="backtest-row-chevron" aria-hidden>▶</span>
                                  <span>{r.tradingsymbol || r.symbol}</span>
                                  <span className="backtest-col-current-price">
                                    {r.currentPrice != null && Number.isFinite(Number(r.currentPrice))
                                      ? Number(r.currentPrice).toFixed(2)
                                      : '—'}
                                  </span>
                                  <span>{r.tradesCount ?? 0}</span>
                                  <span>{r.winRate != null ? `${(Number(r.winRate) * 100).toFixed(1)}%` : '—'}</span>
                                  <span style={{ color: (r.totalReturn ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                    {r.totalReturn != null ? `${(Number(r.totalReturn) * 100).toFixed(2)}%` : '—'}
                                  </span>
                                </summary>
                                <div className="backtest-details-body">
                                  {loading ? (
                                    <p className="muted" style={{ margin: 0 }}>Loading…</p>
                                  ) : detail ? (
                                    <>
                                      <p className="muted" style={{ marginBottom: 8, fontSize: '0.85rem' }}>
                                        Max holding:{' '}
                                        <strong>
                                          {detail.maxHoldingDays != null
                                            ? `${detail.maxHoldingDays} bar${detail.maxHoldingDays === 1 ? '' : 's'}`
                                            : 'None'}
                                        </strong>
                                        {' · '}Trades: <strong>{detail.tradesCount ?? 0}</strong>
                                        {' · '}Win rate: <strong>{detail.winRate != null ? `${(Number(detail.winRate) * 100).toFixed(1)}%` : '—'}</strong>
                                        {' · '}Avg confidence: <strong>{detail.avgConfidenceScore != null ? Number(detail.avgConfidenceScore).toFixed(1) : '—'}</strong>
                                        {' · '}Total return: <strong style={{ color: (detail.totalReturn ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                          {detail.totalReturn != null ? `${(Number(detail.totalReturn) * 100).toFixed(2)}%` : '—'}
                                        </strong>
                                      </p>
                                      {Array.isArray(detail.trades) && detail.trades.length > 0 ? (
                                        <div className="dashboard-table-wrap" style={{ maxHeight: 260 }}>
                                          <TradeDetailsTable trades={detail.trades} />
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
                )}
                {backtestCombinedRowsWithTrades.length > 0 && backtestCombinedHiddenZeroTrades > 0 ? (
                  <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: '0.8rem' }}>
                    Hiding {backtestCombinedHiddenZeroTrades} symbol
                    {backtestCombinedHiddenZeroTrades === 1 ? '' : 's'} with 0 trades.
                  </p>
                ) : null}
              </>
            )}
          </div>
        )}
        {backtestResult && (
          <div className="dashboard-card" style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
            <h3 className="dashboard-card-title" style={{ fontSize: '0.95rem', marginBottom: 8 }}>Backtest: {backtestResult.symbol}</h3>
            <div className="rsi-setup-backtest-filter-badge" role="status">
              <span className="muted" style={{ fontWeight: 600 }}>Active filter</span>
              <span>
                Mode:{' '}
                <strong>{String(backtestResult.mode || rsiSetupMode).toUpperCase()}</strong>
              </span>
              <span>
                Max holding:{' '}
                <strong>
                  {backtestResult.maxHoldingDays != null
                    ? `${backtestResult.maxHoldingDays} daily bar${backtestResult.maxHoldingDays === 1 ? '' : 's'}`
                    : 'None (unlimited)'}
                </strong>
              </span>
              <span>
                Price (last close):{' '}
                <strong>
                  {formatBacktestPriceRange(backtestResult.minPrice, backtestResult.maxPrice)}
                </strong>
              </span>
            </div>
            <p className="muted" style={{ marginBottom: 8 }}>
              Current price:{' '}
              <strong>
                {backtestResult.currentPrice != null && Number.isFinite(Number(backtestResult.currentPrice))
                  ? Number(backtestResult.currentPrice).toFixed(2)
                  : '—'}
              </strong>
              {' · '}
              Trades: <strong>{backtestResult.tradesCount ?? 0}</strong>
              {' · '}Win rate: <strong>{backtestResult.winRate != null ? `${(Number(backtestResult.winRate) * 100).toFixed(1)}%` : '—'}</strong>
              {' · '}Avg confidence: <strong>{backtestResult.avgConfidenceScore != null ? Number(backtestResult.avgConfidenceScore).toFixed(1) : '—'}</strong>
              {' · '}Total return: <strong style={{ color: (backtestResult.totalReturn ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {backtestResult.totalReturn != null ? `${(Number(backtestResult.totalReturn) * 100).toFixed(2)}%` : '—'}
              </strong>
            </p>
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
                  <TradeDetailsTable trades={backtestResult.trades} />
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
              <option value="SELL">SELL</option>
              <option value="HOLD">HOLD</option>
            </select>
            <span className="signals-stacked-label" style={{ marginRight: 4 }}>RSI:</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={rsiFilterMin}
              onChange={(e) => setRsiFilterMin(e.target.value === '' ? '' : Number(e.target.value))}
              className="bot-live-input"
              style={{ width: 52 }}
              placeholder="Min"
            />
            <span className="muted">–</span>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={rsiFilterMax}
              onChange={(e) => setRsiFilterMax(e.target.value === '' ? '' : Number(e.target.value))}
              className="bot-live-input"
              style={{ width: 52 }}
              placeholder="Max"
            />
          </div>
        </div>
        <div className="dashboard-table-wrap rsi-setup-table-wrap" style={{ maxHeight: 480 }}>
          <table className="dashboard-table rsi-setup-signals-table">
            <thead>
              <tr>
                <th className="rsi-setup-col-symbol">Instrument</th>
                <th className="rsi-setup-col-rsi">RSI</th>
                <th className="rsi-setup-col-price">Current price</th>
                <th className="rsi-setup-col-signal">Signal</th>
                <th className="rsi-setup-col-synced">Last synced</th>
                <th className="rsi-setup-col-explain">Explain</th>
              </tr>
            </thead>
            <tbody>
              {loading && signals.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
                    Loading RSI Setup for symbols with stored candles…
                  </td>
                </tr>
              ) : filteredSignals.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
                    {signals.length === 0
                      ? 'No RSI Setup signals. Sync symbols from NSE Historical Sync first, then Refresh.'
                      : 'No matches. Try a different search, signal filter, or RSI range.'}
                  </td>
                </tr>
              ) : (
                filteredSignals.map((s, i) => (
                  <tr key={`${s.tradingsymbol || s.instrument || ''}-${String(s.entryTime ?? '')}-${s.entryPrice ?? ''}-${i}`}>
                    <td style={{ verticalAlign: 'top' }}>
                      {s.tradingsymbol || s.instrument || '—'}
                    </td>
                    <td style={{ verticalAlign: 'top' }}>
                      {s.rsi != null ? Number(s.rsi).toFixed(1) : '—'}
                    </td>
                    <td style={{ verticalAlign: 'top', textAlign: 'right' }} className="rsi-setup-col-price">
                      {s.currentPrice != null && Number.isFinite(Number(s.currentPrice))
                        ? Number(s.currentPrice).toFixed(2)
                        : '—'}
                    </td>
                    <td style={{ verticalAlign: 'top' }}>
                      <div className="signals-stacked-cell">
                        <div>{signalCell(s.signal_type)}</div>
                        <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                          {s.entryPrice != null && (
                            <span style={{ marginRight: 8 }}>Entry: {Number(s.entryPrice).toFixed(2)}</span>
                          )}
                          {s.entryTime && (
                            <span style={{ marginRight: 8 }}>Date: {formatTradeTime(s.entryTime)}</span>
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
                    <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      {formatLastSynced(lastUpdatedBySymbol[s.instrument] ?? lastUpdatedBySymbol[s.symbol])}
                    </td>
                    <td className="rsi-setup-explain-cell">
                      <div className="rsi-setup-explain-text">
                        {s.explanation || 'No explanation available.'}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8, marginBottom: 0 }}>
          {filteredSignals.length} shown{(search || signalTypeFilter !== 'all' || (Number.isFinite(Number(rsiFilterMin)) && Number.isFinite(Number(rsiFilterMax)))) ? ` of ${signals.length}` : ''}
          {typeof checkedCount === 'number' ? ` (${checkedCount} symbols checked)` : ''}. RSI filter: {rsiFilterMin}–{rsiFilterMax}. 1D only. Auto-refresh every 60s.
        </p>
        {error && <p className="bot-live-error" style={{ marginTop: 8 }}>{error}</p>}
      </div>
    </div>
  );
}
