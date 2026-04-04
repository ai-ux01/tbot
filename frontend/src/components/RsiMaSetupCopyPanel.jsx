import { useState, useEffect, useCallback, useMemo, useRef, useTransition } from 'react';
import { Link } from 'react-router-dom';
import {
  getRsiMaSetupCopyCombined,
  postRsiMaSetupCopyBacktest,
  getRsiMaSetupCopyBacktestCombined,
} from '../api/signals';
import { paperTick, paperForceDailyPipeline } from '../api/paperTrading';
import {
  RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT,
  RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT,
  RSI_MA_COPY_DEFAULT_PARTIAL_EXIT_QTY_PERCENT,
  RSI_MA_COPY_DEFAULT_MIN_STOCK_PRICE,
  rsiMaCopyPriceQueryFromInputs,
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
          <th>Lowest dip &lt; 40 (low)</th>
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
  /** 80 = default partial; 100 = full exit at first TP (no remainder RSI leg). */
  const [partialExitQtyPercent, setPartialExitQtyPercent] = useState(RSI_MA_COPY_DEFAULT_PARTIAL_EXIT_QTY_PERCENT);
  /** Empty min → server uses default min stock price (₹20). Empty max → no upper cap. */
  const [minStockPriceInput, setMinStockPriceInput] = useState('');
  const [maxStockPriceInput, setMaxStockPriceInput] = useState('');
  /** Optional UTC calendar-day bounds (YYYY-MM-DD) for signals + backtests (matches stored candle `time`). */
  const [copyFromDate, setCopyFromDate] = useState('');
  const [copyToDate, setCopyToDate] = useState('');
  const copyPriceBandParams = useMemo(
    () => rsiMaCopyPriceQueryFromInputs(minStockPriceInput, maxStockPriceInput),
    [minStockPriceInput, maxStockPriceInput],
  );
  const copyDateParams = useMemo(() => {
    const o = {};
    const f = String(copyFromDate || '').trim();
    const t = String(copyToDate || '').trim();
    if (f) o.fromDate = f;
    if (t) o.toDate = t;
    return o;
  }, [copyFromDate, copyToDate]);
  const [backtestSeries, setBacktestSeries] = useState('day');
  /** Same key for lazy row fetch and combined-table lookup (must stay in sync). */
  const rsiMaCopyDetailCacheKey = useCallback(
    (sym) =>
      `${sym}\0${backtestSeries}\0${profitTargetPctInput}\0${rsiRemainderExitInput}\0${partialExitQtyPercent}\0${minStockPriceInput}\0${maxStockPriceInput}\0${copyFromDate}\0${copyToDate}`,
    [
      backtestSeries,
      profitTargetPctInput,
      rsiRemainderExitInput,
      partialExitQtyPercent,
      minStockPriceInput,
      maxStockPriceInput,
      copyFromDate,
      copyToDate,
    ],
  );
  const [backtestDetailCache, setBacktestDetailCache] = useState({});
  const [backtestDetailLoading, setBacktestDetailLoading] = useState({});
  const backtestDetailFetchedRef = useRef(new Set());
  const [lastUpdatedBySymbol, setLastUpdatedBySymbol] = useState({});
  const [listUiPending, startListTransition] = useTransition();
  const [mainTab, setMainTab] = useState('signals');
  /** `all` = every symbol with BUY setups + HOLD rows; `live` = BUY only when the latest daily bar is the entry bar (default load). */
  const [signalsListMode, setSignalsListMode] = useState('live');
  const [liveBuyCount, setLiveBuyCount] = useState(null);
  const [activeFetchMode, setActiveFetchMode] = useState(null);
  const [paperOrderValueInr, setPaperOrderValueInr] = useState(10_000);
  const [paperBusySymbol, setPaperBusySymbol] = useState(null);
  const [paperActionError, setPaperActionError] = useState(null);
  const [paperActionMessage, setPaperActionMessage] = useState(null);
  const [forceDailyBusy, setForceDailyBusy] = useState(false);

  const fetchSignals = useCallback(
    async (explicitMode) => {
      const mode = explicitMode !== undefined ? explicitMode : signalsListMode;
      const liveOnly = mode === 'live';
      setError(null);
      setPaperActionError(null);
      setPaperActionMessage(null);
      setLoading(true);
      setActiveFetchMode(mode);
      try {
        const [data, lastUpdatedRes] = await Promise.all([
          getRsiMaSetupCopyCombined({
            ...(liveOnly ? { liveOnly: true } : {}),
            profitTargetPct: profitTargetPctInput,
            rsiRemainderExit: rsiRemainderExitInput,
            partialTpFraction: partialExitQtyPercent,
            ...copyPriceBandParams,
            ...copyDateParams,
          }),
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
    [
      signalsListMode,
      startListTransition,
      profitTargetPctInput,
      rsiRemainderExitInput,
      partialExitQtyPercent,
      copyPriceBandParams,
      copyDateParams,
    ],
  );

  const placePaperBuyFromRow = useCallback(
    async (s) => {
      const sym = String(s.instrument || s.tradingsymbol || '').trim();
      if (!sym || s.signal_type !== 'BUY') return;
      setPaperActionError(null);
      setPaperActionMessage(null);
      setError(null);
      setPaperBusySymbol(sym);
      try {
        const data = await paperTick({
          setupId: 'rsi-ma-setup-copy',
          symbol: sym,
          orderValueInr: paperOrderValueInr,
          series: 'day',
          profitTargetPct: profitTargetPctInput,
          rsiRemainderExit: rsiRemainderExitInput,
          partialTpFraction: partialExitQtyPercent,
          maxHoldingDays,
          ...copyPriceBandParams,
        });
        if (!data.ok) {
          setPaperActionError(data.error || data.reason || 'Paper order failed');
          return;
        }
        if (data.action === 'OPEN' && data.position) {
          const q = data.position.qty;
          const px = data.position.entryPrice;
          setPaperActionMessage(
            `Paper long opened: ${sym} — ${q} @ ${px != null ? Number(px).toFixed(2) : '—'} (setup re-checked on latest daily bar).`,
          );
        } else if (data.action === 'NONE') {
          const st = data.snapshot?.signal_type ?? '—';
          setPaperActionMessage(
            `No new position: latest bar evaluates ${st} for ${sym} (open only when evaluate() is BUY).`,
          );
        } else if (data.action === 'SKIP') {
          setPaperActionError(data.reason || data.error || 'Skipped');
        } else if (data.action === 'CLOSE') {
          const r = data.trade?.exitReason ?? data.snapshot?.signal_type;
          const pnl = data.trade?.realizedPnl;
          setPaperActionMessage(
            `Paper position closed for ${sym}${r ? ` (${r})` : ''}${
              pnl != null && Number.isFinite(Number(pnl)) ? ` · PnL ${Number(pnl).toFixed(2)}` : ''
            }.`,
          );
        } else if (data.action === 'PARTIAL') {
          setPaperActionMessage(
            `Paper partial TP ${sym}: sold ${data.soldQty ?? '—'} @ ${data.price != null ? Number(data.price).toFixed(2) : '—'}.`,
          );
        } else {
          setPaperActionMessage(data.action ? `Paper: ${data.action}` : 'Paper tick done.');
        }
      } catch (e) {
        setPaperActionError(e?.message ?? 'Paper order failed');
      } finally {
        setPaperBusySymbol(null);
      }
    },
    [paperOrderValueInr, profitTargetPctInput, rsiRemainderExitInput, partialExitQtyPercent, maxHoldingDays, copyPriceBandParams],
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

  const runForceDailyPaper = useCallback(async () => {
    setForceDailyBusy(true);
    setPaperActionError(null);
    setPaperActionMessage(null);
    try {
      // Use full `signals` (all loaded BUYs for live/all mode), not `filteredSignals`. The table filter
      // can hide BUY rows (e.g. HOLD-only view) which would otherwise send an empty body and skip client rows.
      const searchLower = search.trim().toLowerCase();
      const buyRows = signals
        .filter((s) => s.signal_type === 'BUY')
        .filter((s) => {
          if (!searchLower) return true;
          return [s.instrument, s.tradingsymbol].some((v) =>
            String(v || '').toLowerCase().includes(searchLower),
          );
        })
        .slice(0, 120)
        .map((s) => ({
          setupId: 'rsi-ma-setup-copy',
          symbol: String(s.instrument || s.tradingsymbol || '').trim(),
          orderValueInr: paperOrderValueInr,
          series: 'day',
          profitTargetPct: profitTargetPctInput,
          rsiRemainderExit: rsiRemainderExitInput,
          partialTpFraction: partialExitQtyPercent,
          maxHoldingDays,
          ...copyPriceBandParams,
        }))
        .filter((r) => r.symbol);

      const data = await paperForceDailyPipeline(buyRows.length > 0 ? { rows: buyRows } : {});
      const n = Array.isArray(data.auto) ? data.auto.length : 0;
      const ex = data.exits?.processed ?? 0;
      const src = data.meta?.source === 'request_body' ? 'this table (BUY rows)' : 'server env PAPER_TRADING_AUTO';
      let msg = `Daily paper job: ${ex} open position(s) checked for exits, ${n} auto-tick run(s) (${src}).`;
      if (buyRows.length > 0) {
        msg += ` Sent ${buyRows.length} BUY row(s) from loaded signals${searchLower ? ' (search applied)' : ''}.`;
      } else if (signals.length > 0) {
        msg += ' No BUY signals in the current load — refresh signals or switch Live / All mode.';
      }
      if (Array.isArray(data.meta?.warnings) && data.meta.warnings.length > 0) {
        msg += ` ${data.meta.warnings.join(' ')}`;
      }
      setPaperActionMessage(msg);
    } catch (e) {
      setPaperActionError(e?.message ?? 'Daily paper job failed');
    } finally {
      setForceDailyBusy(false);
    }
  }, [
    signals,
    search,
    paperOrderValueInr,
    profitTargetPctInput,
    rsiRemainderExitInput,
    partialExitQtyPercent,
    maxHoldingDays,
    copyPriceBandParams,
  ]);

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
        partialTpFraction: partialExitQtyPercent,
        ...copyPriceBandParams,
      };
      if (backtestMode === 'all') {
        const data = await getRsiMaSetupCopyBacktestCombined({
          maxHoldingDays,
          series: backtestSeries,
          ...copyExitParams,
          ...copyDateParams,
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
          ...copyDateParams,
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
    partialExitQtyPercent,
    copyPriceBandParams,
    copyDateParams,
    startListTransition,
  ]);

  const fetchBacktestDetailsIfNeeded = useCallback(async (symbol) => {
    const cacheKey = rsiMaCopyDetailCacheKey(symbol);
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
        partialTpFraction: partialExitQtyPercent,
        ...copyPriceBandParams,
        ...copyDateParams,
      });
      startListTransition(() => setBacktestDetailCache((c) => ({ ...c, [cacheKey]: data })));
    } catch {
      backtestDetailFetchedRef.current.delete(cacheKey);
      startListTransition(() => setBacktestDetailCache((c) => ({ ...c, [cacheKey]: null })));
    } finally {
      setBacktestDetailLoading((l) => ({ ...l, [cacheKey]: false }));
    }
  }, [
    maxHoldingDays,
    backtestSeries,
    profitTargetPctInput,
    rsiRemainderExitInput,
    partialExitQtyPercent,
    minStockPriceInput,
    maxStockPriceInput,
    copyPriceBandParams,
    copyDateParams,
    rsiMaCopyDetailCacheKey,
    startListTransition,
  ]);

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
              title={`Partial exit scales out at this % gain vs avg cost (default ${RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT}%).`}
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
            <span className="muted" style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }} title="Exit remaining position when bar RSI ≥ this">
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className="muted" style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }} title="Share of position sold at the first take-profit level">
              Exit at 1st TP
            </span>
            <select
              className="bot-live-input"
              style={{ minWidth: 140 }}
              value={partialExitQtyPercent}
              onChange={(e) => setPartialExitQtyPercent(Number(e.target.value))}
            >
              <option value={80}>80% of qty</option>
              <option value={100}>100% (full)</option>
            </select>
          </label>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            title="Reset to rsiMaSetupCopy.js defaults"
            onClick={() => {
              setProfitTargetPctInput(RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT);
              setRsiRemainderExitInput(RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT);
              setPartialExitQtyPercent(RSI_MA_COPY_DEFAULT_PARTIAL_EXIT_QTY_PERCENT);
              setMinStockPriceInput('');
              setMaxStockPriceInput('');
              setCopyFromDate('');
              setCopyToDate('');
            }}
          >
            Reset defaults
          </button>
        </div>
        <div className="rsi-ma-copy-exit-filters-row" style={{ marginTop: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span
              className="muted"
              style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}
              title={`Min price (₹) for cross-down close and entry low. Leave blank for server default (₹${RSI_MA_COPY_DEFAULT_MIN_STOCK_PRICE}).`}
            >
              Setup min ₹
            </span>
            <input
              type="number"
              min={0}
              step={1}
              placeholder={`default ${RSI_MA_COPY_DEFAULT_MIN_STOCK_PRICE}`}
              value={minStockPriceInput}
              onChange={(e) => setMinStockPriceInput(e.target.value)}
              className="bot-live-input"
              style={{ width: 88, minWidth: 72 }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span
              className="muted"
              style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}
              title="Optional max price (₹) for cross-down close and entry low. Blank = no cap."
            >
              Setup max ₹
            </span>
            <input
              type="number"
              min={0}
              step={1}
              placeholder="none"
              value={maxStockPriceInput}
              onChange={(e) => setMaxStockPriceInput(e.target.value)}
              className="bot-live-input"
              style={{ width: 88, minWidth: 72 }}
            />
          </label>
        </div>
        <div className="rsi-ma-copy-exit-filters-row" style={{ marginTop: 10 }}>
          <span
            className="muted"
            style={{ fontSize: '0.85rem', color: 'var(--text-primary)', marginRight: 4 }}
            title="Stored daily candle dates are UTC. Signals: filter BUY rows / live bar by entry or last bar in range. Backtests: load candles in range (with warmup before from) and keep trades whose entry falls in range."
          >
            Date range (UTC)
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              From
            </span>
            <input
              type="date"
              className="bot-live-input"
              style={{ width: 'auto', minWidth: 130 }}
              value={copyFromDate}
              onChange={(e) => setCopyFromDate(e.target.value)}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              To
            </span>
            <input
              type="date"
              className="bot-live-input"
              style={{ width: 'auto', minWidth: 130 }}
              value={copyToDate}
              onChange={(e) => setCopyToDate(e.target.value)}
            />
          </label>
        </div>
        <p className="muted" style={{ margin: '10px 0 0', fontSize: '0.75rem', lineHeight: 1.4 }}>
          Used for backtests and for <strong>SL / partial TP / remainder RSI</strong> shown on the Signals tab (same rules as{' '}
          <code>runBacktest</code> in <code>rsiMaSetupCopy.js</code>). <strong>100% at 1st TP</strong> exits the whole position at
          the partial TP price (no remainder RSI leg). <strong>Setup min/max</strong> filter which BUYs qualify (cross bar close and
          entry low must fall in range). <strong>Date range</strong> is optional; leave both blank for full stored history (default).
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
            )}{' '}
            <strong>Paper buy</strong> uses the same <code>rsi-ma-setup-copy</code> rules as{' '}
            <Link to="/paper-trading">Paper trading</Link> (one open long per symbol). After entry, the server can run daily
            SL / partial TP / remainder RSI / max hold on the latest daily bar (11:59 AM Asia/Kolkata cron when DB is up; set{' '}
            <code>PAPER_TRADING_DAILY_BAR_EXITS=0</code> to disable). While a position is open, new BUYs for that symbol are
            skipped.{' '}
            <strong>Scheduled cron</strong> (default) scans the same stored candles and auto-ticks every live daily BUY here
            (set <code>PAPER_TRADING_RSI_MA_COPY_LIVE=0</code> to turn that off). Optional <code>PAPER_TRADING_AUTO</code>{' '}
            rows merge in and override the same symbol. <strong>Run daily paper job</strong> below runs one immediate pipeline
            using your loaded BUY list (up to 120) without waiting for cron.
          </p>
          <div className="dashboard-card-header-with-filters">
            <h3 className="dashboard-card-title" style={{ marginBottom: 0 }}>Signals (1D)</h3>
            <div className="dashboard-toolbar" style={{ marginBottom: 0, flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }} title="Notional per paper BUY (qty = floor(value ÷ last close))">
                  Paper ₹
                </span>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={paperOrderValueInr}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setPaperOrderValueInr(Number.isFinite(v) && v >= 1000 ? Math.floor(v) : 10_000);
                  }}
                  className="bot-live-input"
                  style={{ width: 100 }}
                />
              </label>
              <button
                type="button"
                className="btn-secondary"
                disabled={forceDailyBusy || loading}
                title="Bar exits on all open paper positions, then auto-ticks every loaded BUY signal here (up to 120), ignoring the BUY/HOLD table filter; search box still narrows symbols. If none sent, server uses PAPER_TRADING_AUTO env."
                onClick={runForceDailyPaper}
              >
                {forceDailyBusy ? 'Running…' : 'Run daily paper job'}
              </button>
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
                            {s.firstDipBelow40Close != null && (
                              <span style={{ marginRight: 8 }}>Lowest dip&lt;40 low: {Number(s.firstDipBelow40Close).toFixed(2)}</span>
                            )}
                            {s.entryTime && <span style={{ marginRight: 8 }}>Date: {formatTradeTime(s.entryTime)}</span>}
                            {s.signal_type === 'BUY' && s.stopLossPrice != null && (
                              <span style={{ marginRight: 8, display: 'inline-block' }}>
                                <span className="signals-stacked-label">SL:</span> {Number(s.stopLossPrice).toFixed(2)}
                                {s.stopLossPct != null && <span> (−{Number(s.stopLossPct).toFixed(2)}%)</span>}
                              </span>
                            )}
                            {s.signal_type === 'BUY' && s.partialTakeProfitPrice != null && (
                              <span style={{ marginRight: 8, display: 'inline-block' }}>
                                <span className="signals-stacked-label">Partial TP:</span> {Number(s.partialTakeProfitPrice).toFixed(2)}
                                {s.partialTakeProfitPct != null && (
                                  <span>
                                    {' '}
                                    (+{Number(s.partialTakeProfitPct).toFixed(2)}%
                                    {s.partialTpFraction != null ? `, ${(Number(s.partialTpFraction) * 100).toFixed(0)}% qty` : ''})
                                  </span>
                                )}
                              </span>
                            )}
                            {s.signal_type === 'BUY' && s.rsiRemainderExit != null && (
                              <span style={{ marginRight: 8, display: 'inline-block' }}>
                                <span className="signals-stacked-label">Remainder:</span> RSI ≥ {s.rsiRemainderExit}
                              </span>
                            )}
                            <span className="signals-stacked-label">Updated:</span> {formatTime(s.createdAt)}
                          </div>
                          {s.signal_type === 'BUY' && (
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ fontSize: '0.75rem', marginTop: 8, padding: '5px 10px' }}
                              disabled={paperBusySymbol != null}
                              onClick={() => placePaperBuyFromRow(s)}
                              title="Virtual BUY: re-evaluates copy setup on latest daily bar; opens long if BUY and no open position for this symbol."
                            >
                              {paperBusySymbol === String(s.instrument || s.tradingsymbol || '').trim()
                                ? 'Placing…'
                                : 'Paper buy'}
                            </button>
                          )}
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
          {paperActionMessage && (
            <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: '0.85rem' }}>{paperActionMessage}</p>
          )}
          {paperActionError && (
            <p className="bot-live-error" style={{ marginTop: 8, marginBottom: 0 }}>{paperActionError}</p>
          )}
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
              {' · '}
              1st TP exit:{' '}
              <strong>
                {backtestCombinedResult.partialTpFraction != null
                  ? `${(Number(backtestCombinedResult.partialTpFraction) * 100).toFixed(0)}% qty`
                  : '—'}
              </strong>
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
                    const cacheKey = rsiMaCopyDetailCacheKey(sym);
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
              {' · '}
              1st TP exit:{' '}
              <strong>
                {backtestResult.partialTpFraction != null
                  ? `${(Number(backtestResult.partialTpFraction) * 100).toFixed(0)}% qty`
                  : '—'}
              </strong>
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
