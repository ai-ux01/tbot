import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getPaperSetups,
  getPaperState,
  resetPaperPortfolio,
  previewPaperSetup,
  paperTick,
  paperClose,
  getPaperTrades,
  getPaperTradesByMonth,
  paperForceDailyPipeline,
  getPaperScheduleStatus,
} from '../api/paperTrading';
import { computeOpenPositionDisplay } from '../utils/paperPositionDisplay.js';

/** ISO or Mongo date → readable local string (default IST). */
function formatPaperDateTime(value, timeZone = 'Asia/Kolkata') {
  if (value == null || value === '') return '—';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 19);
    return d.toLocaleString('en-IN', {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return String(value).slice(0, 19);
  }
}

/** YYYY-MM-DD in a timezone (en-CA gives ISO-like date). */
function calendarDateInTz(iso, timeZone = 'Asia/Kolkata') {
  if (iso == null || iso === '') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const y = parts.find((x) => x.type === 'year')?.value;
    const m = parts.find((x) => x.type === 'month')?.value;
    const day = parts.find((x) => x.type === 'day')?.value;
    if (!y || !m || !day) return null;
    return `${y}-${m}-${day}`;
  } catch {
    return null;
  }
}

function openedAtInDateRange(openedAt, fromStr, toStr, tz = 'Asia/Kolkata') {
  const from = String(fromStr || '').trim();
  const to = String(toStr || '').trim();
  if (!from && !to) return true;
  const cal = calendarDateInTz(openedAt, tz);
  if (!cal) return false;
  if (from && cal < from) return false;
  if (to && cal > to) return false;
  return true;
}

/** Today's calendar date YYYY-MM-DD in timezone. */
function todayCalendarDateInTz(tz = 'Asia/Kolkata') {
  return calendarDateInTz(new Date(), tz) || '';
}

/** Last calendar day of month (1–12) in year y. */
function lastDayOfMonth(y, month1to12) {
  const m = Number(month1to12);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return 31;
  return new Date(y, m, 0).getDate();
}

/**
 * @param {'all'|'day'|'month'|'year'|'range'} period
 */
function computeOpenPosEffectiveRange(period, fields) {
  const { openPosFromDate, openPosToDate, openPosDay, openPosMonth, openPosYear } = fields;
  if (period === 'all') return { from: '', to: '' };
  if (period === 'range') {
    return { from: String(openPosFromDate || '').trim(), to: String(openPosToDate || '').trim() };
  }
  if (period === 'day') {
    const d = String(openPosDay || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { from: '', to: '' };
    return { from: d, to: d };
  }
  if (period === 'month') {
    const raw = String(openPosMonth || '').trim();
    if (!/^\d{4}-\d{2}$/.test(raw)) return { from: '', to: '' };
    const [ys, ms] = raw.split('-');
    const y = Number(ys);
    const m = Number(ms);
    const last = lastDayOfMonth(y, m);
    const pad = (n) => String(n).padStart(2, '0');
    return { from: `${ys}-${ms}-01`, to: `${ys}-${ms}-${pad(last)}` };
  }
  if (period === 'year') {
    const ys = String(openPosYear || '').trim().slice(0, 4);
    if (!/^\d{4}$/.test(ys)) return { from: '', to: '' };
    return { from: `${ys}-01-01`, to: `${ys}-12-31` };
  }
  return { from: '', to: '' };
}

export function PaperTradingPanel() {
  const [setups, setSetups] = useState([]);
  const [state, setState] = useState(null);
  const [setupId, setSetupId] = useState('rsi-setup');
  const [symbol, setSymbol] = useState('');
  const [series, setSeries] = useState('day');
  const [orderValueInr, setOrderValueInr] = useState(10_000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [lastTick, setLastTick] = useState(null);
  const [historyTz, setHistoryTz] = useState('ist');
  const [historyYear, setHistoryYear] = useState(() => new Date().getFullYear());
  const [historyMonth, setHistoryMonth] = useState('');
  const [dbByMonth, setDbByMonth] = useState(null);
  const [dbTrades, setDbTrades] = useState(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbMessage, setDbMessage] = useState(null);
  const [scheduleStatus, setScheduleStatus] = useState(null);
  const [forceDailyLoading, setForceDailyLoading] = useState(false);
  const [forceDailyResult, setForceDailyResult] = useState(null);
  const [forceDailyError, setForceDailyError] = useState(null);
  /** Custom range only when openPosPeriod === 'range' */
  const [openPosFromDate, setOpenPosFromDate] = useState('');
  const [openPosToDate, setOpenPosToDate] = useState('');
  /** all | day | month | year | range — openedAt compared on IST calendar day */
  const [openPosPeriod, setOpenPosPeriod] = useState('all');
  const [openPosDay, setOpenPosDay] = useState('');
  const [openPosMonth, setOpenPosMonth] = useState('');
  const [openPosYear, setOpenPosYear] = useState(() => String(new Date().getFullYear()));

  const setupMeta = setups.find((s) => s.id === setupId);

  const openPosEffectiveRange = useMemo(
    () =>
      computeOpenPosEffectiveRange(openPosPeriod, {
        openPosFromDate,
        openPosToDate,
        openPosDay,
        openPosMonth,
        openPosYear,
      }),
    [openPosPeriod, openPosFromDate, openPosToDate, openPosDay, openPosMonth, openPosYear],
  );

  const filteredOpenPositions = useMemo(() => {
    const list = state?.positions;
    if (!Array.isArray(list) || list.length === 0) return [];
    return list.filter((p) =>
      openedAtInDateRange(p.openedAt, openPosEffectiveRange.from, openPosEffectiveRange.to),
    );
  }, [state?.positions, openPosEffectiveRange.from, openPosEffectiveRange.to]);

  const loadSetups = useCallback(async () => {
    try {
      const data = await getPaperSetups();
      setSetups(Array.isArray(data.setups) ? data.setups : []);
    } catch {
      setSetups([]);
    }
  }, []);

  const loadState = useCallback(async () => {
    try {
      const data = await getPaperState();
      setState(data);
    } catch {
      setState(null);
    }
  }, []);

  const loadScheduleStatus = useCallback(async () => {
    try {
      const data = await getPaperScheduleStatus();
      setScheduleStatus(data);
    } catch {
      setScheduleStatus(null);
    }
  }, []);

  useEffect(() => {
    loadSetups();
    loadState();
    loadScheduleStatus();
  }, [loadSetups, loadState, loadScheduleStatus]);

  const loadDbByMonth = useCallback(async () => {
    setDbLoading(true);
    setDbMessage(null);
    try {
      const data = await getPaperTradesByMonth({ year: historyYear, tz: historyTz });
      setDbByMonth(data);
      if (data.message) setDbMessage(data.message);
    } catch (e) {
      setDbByMonth({ months: [], tz: historyTz });
      setDbMessage(e?.message ?? 'Failed to load month summary');
    } finally {
      setDbLoading(false);
    }
  }, [historyYear, historyTz]);

  const loadDbTradesForMonth = useCallback(async (month) => {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return;
    setDbLoading(true);
    setDbMessage(null);
    try {
      const data = await getPaperTrades({ month, tz: historyTz, limit: 200 });
      setDbTrades(data);
      setHistoryMonth(month);
    } catch (e) {
      setDbTrades(null);
      setDbMessage(e?.message ?? 'Failed to load trades');
    } finally {
      setDbLoading(false);
    }
  }, [historyTz]);

  useEffect(() => {
    loadDbByMonth();
  }, [loadDbByMonth]);

  const runPreview = async () => {
    setError(null);
    setPreview(null);
    const sym = symbol.trim();
    if (!sym) {
      setError('Enter a symbol (stored candles / instrument).');
      return;
    }
    setLoading(true);
    try {
      const body = { setupId, symbol: sym };
      if (setupMeta?.hasSeries) body.series = series;
      const data = await previewPaperSetup(body);
      setPreview(data);
    } catch (e) {
      setError(e?.message ?? 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const runTick = async () => {
    setError(null);
    setLastTick(null);
    const sym = symbol.trim();
    if (!sym) {
      setError('Enter a symbol.');
      return;
    }
    setLoading(true);
    try {
      const body = {
        setupId,
        symbol: sym,
        orderValueInr,
      };
      if (setupMeta?.hasSeries) body.series = series;
      const data = await paperTick(body);
      setLastTick(data);
      setState(data.state ?? null);
      if (data.action === 'CLOSE' && data.ok) loadDbByMonth();
      if (data.snapshot && !data.ok && data.error) setError(data.error);
    } catch (e) {
      setError(e?.message ?? 'Tick failed');
    } finally {
      setLoading(false);
    }
  };

  const runClose = async () => {
    setError(null);
    const sym = symbol.trim();
    if (!sym) {
      setError('Enter a symbol.');
      return;
    }
    setLoading(true);
    try {
      const body = { setupId, symbol: sym };
      if (setupMeta?.hasSeries) body.series = series;
      const data = await paperClose(body);
      setState(data.state ?? null);
      if (data.ok) loadDbByMonth();
    } catch (e) {
      setError(e?.message ?? 'Close failed');
    } finally {
      setLoading(false);
    }
  };

  const runReset = async () => {
    if (!window.confirm('Reset in-memory paper cash and open positions? Saved closed trades in MongoDB are not deleted.')) return;
    setLoading(true);
    setError(null);
    try {
      const data = await resetPaperPortfolio();
      setState(data);
      setPreview(null);
      setLastTick(null);
    } catch (e) {
      setError(e?.message ?? 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  const runForceDaily = async () => {
    setForceDailyError(null);
    setForceDailyResult(null);
    setForceDailyLoading(true);
    try {
      const data = await paperForceDailyPipeline();
      setForceDailyResult(data);
      await loadState();
      await loadDbByMonth();
      await loadScheduleStatus();
    } catch (e) {
      setForceDailyError(e?.message ?? 'Force run failed');
    } finally {
      setForceDailyLoading(false);
    }
  };

  return (
    <div className="paper-trading-panel">
      <div className="dashboard-card">
        <h2 className="dashboard-card-title">Paper trading</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Virtual orders from the same setup logic as the backtest hub (stored DB candles). One open long per setup + symbol.
          EMA crossover uses 1H candles and can emit SELL to close. Other setups: use <strong>Close at last price</strong> or tick again when your rules say exit.
          Live cash/positions reset on <strong>Reset portfolio</strong> or server restart; <strong>closed</strong> trades are saved to MongoDB with entry/exit snapshots and month buckets (IST or UTC).
        </p>

        <div
          className="dashboard-card-inner"
          style={{
            marginBottom: 16,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
            border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
            borderRadius: 8,
            padding: '12px 14px',
          }}
        >
          <button
            type="button"
            className="bot-live-button"
            onClick={runForceDaily}
            disabled={loading || forceDailyLoading}
            title="Runs bar exits on every open position, then auto-entry ticks from server env PAPER_TRADING_AUTO (same as the daily cron)"
          >
            {forceDailyLoading ? 'Running…' : 'Run daily job now'}
          </button>
          <span className="muted" style={{ fontSize: '0.85rem', maxWidth: 520, lineHeight: 1.45 }}>
            Force the scheduled pipeline without waiting for cron. Uses <code style={{ fontSize: '0.8em' }}>PAPER_TRADING_AUTO</code> on the server.
          </span>
          {scheduleStatus?.scheduled && scheduleStatus.nextRun && (
            <span className="muted" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
              Next cron:{' '}
              {new Date(scheduleStatus.nextRun).toLocaleString('en-IN', {
                timeZone: scheduleStatus.timezone || 'Asia/Kolkata',
                dateStyle: 'short',
                timeStyle: 'short',
              })}{' '}
              ({scheduleStatus.timezone || 'Asia/Kolkata'})
            </span>
          )}
        </div>

        {forceDailyError && (
          <p className="bot-live-error" style={{ marginBottom: 12 }}>{forceDailyError}</p>
        )}

        {forceDailyResult && (
          <div className="dashboard-card-inner" style={{ marginBottom: 16 }}>
            <h3 className="dashboard-card-title" style={{ fontSize: '0.95rem' }}>Daily job (manual run)</h3>
            {Array.isArray(forceDailyResult.meta?.warnings) && forceDailyResult.meta.warnings.length > 0 && (
              <ul className="bot-live-error" style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: '0.82rem' }}>
                {forceDailyResult.meta.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Bar exits:{' '}
              {forceDailyResult.exits == null
                ? 'skipped (no DB or disabled)'
                : `${forceDailyResult.exits.processed} open position(s) checked, ${forceDailyResult.exits.results?.length ?? 0} with an outcome`}
              . Auto ticks:{' '}
              {Array.isArray(forceDailyResult.auto) ? `${forceDailyResult.auto.length} symbol(s)` : 'none'}
              {forceDailyResult.meta?.source && forceDailyResult.meta.source !== 'none'
                ? ` (source: ${forceDailyResult.meta.source})`
                : ''}.
            </p>
            {Array.isArray(forceDailyResult.auto) && forceDailyResult.auto.length > 0 && (
              <ul className="muted" style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '0.82rem' }}>
                {forceDailyResult.auto.map((r) => (
                  <li key={`${r.setupId}-${r.symbol}`}>
                    <strong>{r.symbol}</strong> ({r.setupId}): {r.action ?? '—'}
                    {r.error ? ` — ${r.error}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="dashboard-toolbar" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted" style={{ fontSize: '0.8rem' }}>Setup</span>
            <select
              className="bot-live-input"
              style={{ minWidth: 220 }}
              value={setupId}
              onChange={(e) => {
                setSetupId(e.target.value);
                setPreview(null);
                setLastTick(null);
              }}
            >
              {setups.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted" style={{ fontSize: '0.8rem' }}>Symbol</span>
            <input
              className="bot-live-input"
              style={{ width: 140 }}
              placeholder="e.g. RELIANCE"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            />
          </label>
          {setupMeta?.hasSeries && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="muted" style={{ fontSize: '0.8rem' }}>Bars</span>
              <select className="bot-live-input" style={{ width: 100 }} value={series} onChange={(e) => setSeries(e.target.value)}>
                <option value="day">Daily</option>
                <option value="month">Monthly</option>
              </select>
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted" style={{ fontSize: '0.8rem' }}>Order value (₹)</span>
            <input
              type="number"
              min={1000}
              step={1000}
              className="bot-live-input"
              style={{ width: 110 }}
              value={orderValueInr}
              onChange={(e) => {
                const v = Number(e.target.value);
                setOrderValueInr(Number.isFinite(v) && v >= 1000 ? v : 10_000);
              }}
            />
          </label>
          <button type="button" className="btn-secondary" onClick={runPreview} disabled={loading}>
            Preview signal
          </button>
          <button type="button" className="bot-live-button" onClick={runTick} disabled={loading}>
            {loading ? '…' : 'Run tick (trade)'}
          </button>
          <button type="button" className="btn-secondary" onClick={runClose} disabled={loading}>
            Close at last price
          </button>
          <button type="button" className="btn-secondary" onClick={runReset} disabled={loading}>
            Reset portfolio
          </button>
        </div>

        {error && <p className="bot-live-error" style={{ marginBottom: 12 }}>{error}</p>}

        {state && (
          <div className="dashboard-card-inner" style={{ marginBottom: 16 }}>
            <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
              Starting cash: <strong>₹{Number(state.initialCapital).toLocaleString('en-IN')}</strong>
              {' · '}Cash: <strong>₹{Number(state.cash).toLocaleString('en-IN')}</strong>
              {' · '}Invested (open at cost): <strong>₹{Number(state.investedOpen ?? 0).toLocaleString('en-IN')}</strong>
            </p>
          </div>
        )}

        {preview && (
          <div className="dashboard-card-inner" style={{ marginBottom: 16 }}>
            <h3 className="dashboard-card-title" style={{ fontSize: '0.95rem' }}>Preview</h3>
            <p className="muted" style={{ margin: '0 0 8px', fontSize: '0.85rem' }}>
              Signal: <strong>{preview.signal_type}</strong>
              {preview.currentPrice != null && (
                <> · Last close: <strong>{Number(preview.currentPrice).toFixed(2)}</strong></>
              )}
              {preview.barUnit && (
                <> · Bar: <strong>{preview.barUnit}</strong></>
              )}
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>{preview.explanation || '—'}</p>
          </div>
        )}

        {lastTick && (
          <div className="dashboard-card-inner" style={{ marginBottom: 16 }}>
            <h3 className="dashboard-card-title" style={{ fontSize: '0.95rem' }}>Last tick</h3>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Action: <strong>{lastTick.action}</strong>
              {lastTick.message && <> — {lastTick.message}</>}
              {lastTick.reason && <> — {lastTick.reason}</>}
            </p>
          </div>
        )}

        {state?.positions?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h3 className="dashboard-card-title" style={{ fontSize: '0.95rem' }}>Open positions</h3>
            <div
              className="dashboard-toolbar"
              style={{
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'flex-end',
                marginBottom: 10,
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="muted" style={{ fontSize: '0.75rem' }}>Opened (IST)</span>
                <select
                  className="bot-live-input"
                  style={{ minWidth: 140 }}
                  value={openPosPeriod}
                  onChange={(e) => setOpenPosPeriod(e.target.value)}
                >
                  <option value="all">All (no filter)</option>
                  <option value="day">Daily — one day</option>
                  <option value="month">Monthly</option>
                  <option value="year">Yearly</option>
                  <option value="range">Custom range</option>
                </select>
              </label>
              {openPosPeriod === 'day' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>Day</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <input
                      type="date"
                      className="bot-live-input"
                      value={openPosDay}
                      onChange={(e) => setOpenPosDay(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: '0.75rem' }}
                      onClick={() => setOpenPosDay(todayCalendarDateInTz())}
                    >
                      Today (IST)
                    </button>
                  </div>
                </label>
              )}
              {openPosPeriod === 'month' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>Month</span>
                  <input
                    type="month"
                    className="bot-live-input"
                    value={openPosMonth}
                    onChange={(e) => setOpenPosMonth(e.target.value)}
                  />
                </label>
              )}
              {openPosPeriod === 'year' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>Year</span>
                  <input
                    type="number"
                    className="bot-live-input"
                    style={{ width: 100 }}
                    min={2000}
                    max={2100}
                    value={openPosYear}
                    onChange={(e) => setOpenPosYear(e.target.value)}
                  />
                </label>
              )}
              {openPosPeriod === 'range' && (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="muted" style={{ fontSize: '0.75rem' }}>From (IST date)</span>
                    <input
                      type="date"
                      className="bot-live-input"
                      value={openPosFromDate}
                      onChange={(e) => setOpenPosFromDate(e.target.value)}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="muted" style={{ fontSize: '0.75rem' }}>To (IST date)</span>
                    <input
                      type="date"
                      className="bot-live-input"
                      value={openPosToDate}
                      onChange={(e) => setOpenPosToDate(e.target.value)}
                    />
                  </label>
                </>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setOpenPosPeriod('all');
                  setOpenPosFromDate('');
                  setOpenPosToDate('');
                  setOpenPosDay('');
                  setOpenPosMonth('');
                  setOpenPosYear(String(new Date().getFullYear()));
                }}
              >
                Clear filter
              </button>
              <span className="muted" style={{ fontSize: '0.78rem', alignSelf: 'center', maxWidth: 280 }}>
                Showing {filteredOpenPositions.length} of {state.positions.length}
                {openPosPeriod !== 'all' && openPosEffectiveRange.from && (
                  <>
                    {' '}
                    · range {openPosEffectiveRange.from}
                    {openPosEffectiveRange.to !== openPosEffectiveRange.from
                      ? ` → ${openPosEffectiveRange.to}`
                      : ''}{' '}
                    (IST day)
                  </>
                )}
              </span>
            </div>
            <div className="dashboard-table-wrap" style={{ maxHeight: 'none' }}>
              <table className="dashboard-table" style={{ fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th>Setup</th>
                    <th>Instrument</th>
                    <th>Qty</th>
                    <th>Avg entry</th>
                    <th>Invested</th>
                    <th>Opened</th>
                    <th style={{ minWidth: 200 }}>Levels &amp; details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOpenPositions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted" style={{ padding: 16, textAlign: 'center' }}>
                        No open positions in this opened-date range (IST). Clear dates or widen the range.
                      </td>
                    </tr>
                  ) : null}
                  {filteredOpenPositions.map((p) => {
                    const d = computeOpenPositionDisplay(p);
                    const levelParts = [];
                    if (d.stopLossPrice != null) levelParts.push(`SL ₹${d.stopLossPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
                    if (d.partialTpPrice != null) levelParts.push(`Part TP ₹${d.partialTpPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
                    if (d.rsiRemainderExit != null) levelParts.push(`RSI ≥${d.rsiRemainderExit} (remainder)`);
                    if (d.maxHoldingDays != null && d.maxHoldingBars == null) levelParts.push(`${d.maxHoldingDays}d max`);
                    if (d.series) levelParts.push(`${d.series} bars`);
                    if (d.partialTpDone) levelParts.push('partial done');
                    const levelSummary = levelParts.length > 0 ? levelParts.join(' · ') : '—';
                    return (
                      <tr key={p.id}>
                        <td>{p.setupId}</td>
                        <td
                          title={
                            d.instrumentName
                              ? `${d.instrumentName}${d.instrumentSubId ? ` · token ${d.instrumentSubId}` : ''}`
                              : p.symbol && /^\d+$/.test(String(p.symbol).trim())
                                ? 'Numeric instrument id — name appears when this token exists in stored candles with tradingsymbol'
                                : undefined
                          }
                        >
                          {d.instrumentName ? (
                            <>
                              <span style={{ fontWeight: 600 }}>{d.instrumentName}</span>
                              {d.instrumentSubId ? (
                                <>
                                  <br />
                                  <span className="muted" style={{ fontSize: '0.76rem' }}>
                                    id {d.instrumentSubId}
                                  </span>
                                </>
                              ) : null}
                            </>
                          ) : (
                            <>
                              {d.instrumentLabel}
                              {p.symbol && /^\d+$/.test(String(p.symbol).trim()) ? (
                                <span className="muted" style={{ fontSize: '0.72rem', display: 'block', marginTop: 4 }}>
                                  Name appears after NSE sync saved tradingsymbol for this token.
                                </span>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td>{p.qty}</td>
                        <td>{Number(p.entryPrice).toFixed(2)}</td>
                        <td>{d.invested != null ? `₹${d.invested.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</td>
                        <td className="muted" title={p.openedAt ? String(p.openedAt) : undefined}>
                          {formatPaperDateTime(p.openedAt)}
                        </td>
                        <td style={{ verticalAlign: 'top' }}>
                          <details style={{ maxWidth: 420 }}>
                            <summary className="muted" style={{ cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1.35 }}>
                              {levelSummary}
                            </summary>
                            <div
                              className="muted"
                              style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                                fontSize: '0.78rem',
                                lineHeight: 1.5,
                              }}
                            >
                              {p.orderValueInr != null && (
                                <p style={{ margin: '0 0 6px' }}>
                                  <strong>Order value</strong> (tick): ₹{Number(p.orderValueInr).toLocaleString('en-IN')}
                                </p>
                              )}
                              {(d.series || d.timeframe) && (
                                <p style={{ margin: '0 0 6px' }}>
                                  <strong>Series</strong>: {d.series || '—'}
                                  {d.timeframe ? ` · timeframe ${d.timeframe}` : ''}
                                </p>
                              )}
                              {d.maxHoldingBars != null && (
                                <p style={{ margin: '0 0 6px' }}>
                                  <strong>Max hold</strong>: {d.maxHoldingBars} bars
                                </p>
                              )}
                              {d.notes.map((n, i) => (
                                <p key={i} style={{ margin: '0 0 6px' }}>{n}</p>
                              ))}
                              {d.snapshot?.explanation && (
                                <p style={{ margin: '8px 0 0' }}>
                                  <strong>Entry snapshot</strong>
                                  {d.snapshot.signal_type != null && <> · signal <strong>{d.snapshot.signal_type}</strong></>}
                                  {d.snapshot.barUnit != null && <> · bar <strong>{d.snapshot.barUnit}</strong></>}
                                  {d.snapshot.currentPrice != null && (
                                    <> · last close @ entry <strong>{Number(d.snapshot.currentPrice).toFixed(2)}</strong></>
                                  )}
                                  <br />
                                  <span style={{ opacity: 0.92 }}>{d.snapshot.explanation}</span>
                                </p>
                              )}
                              {!d.snapshot?.explanation && d.snapshot?.signal_type && (
                                <p style={{ margin: '8px 0 0' }}>
                                  <strong>At open</strong>: {d.snapshot.signal_type}
                                  {d.snapshot.currentPrice != null && ` · close ${Number(d.snapshot.currentPrice).toFixed(2)}`}
                                </p>
                              )}
                              {p.paperRules && Object.keys(p.paperRules).length > 0 && (
                                <pre
                                  style={{
                                    margin: '10px 0 0',
                                    padding: 8,
                                    fontSize: '0.72rem',
                                    overflow: 'auto',
                                    maxHeight: 160,
                                    background: 'var(--bg-elevated, rgba(0,0,0,0.2))',
                                    borderRadius: 4,
                                  }}
                                >
                                  {JSON.stringify(p.paperRules, null, 2)}
                                </pre>
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

        {state?.closedTrades?.length > 0 && (
          <div>
            <h3 className="dashboard-card-title" style={{ fontSize: '0.95rem' }}>Recent closed (paper)</h3>
            <div className="dashboard-table-wrap" style={{ maxHeight: 280 }}>
              <table className="dashboard-table" style={{ fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th>Setup</th>
                    <th>Symbol</th>
                    <th>Qty</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>P&amp;L</th>
                    <th>Opened</th>
                    <th>Closed</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {state.closedTrades.slice(0, 50).map((t) => (
                    <tr key={t.id}>
                      <td>{t.setupId}</td>
                      <td>{t.tradingsymbol || t.symbol}</td>
                      <td>{t.qty}</td>
                      <td>{Number(t.entryPrice).toFixed(2)}</td>
                      <td>{Number(t.exitPrice).toFixed(2)}</td>
                      <td style={{ color: (t.realizedPnl ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        ₹{Number(t.realizedPnl).toFixed(2)}
                      </td>
                      <td className="muted" title={t.openedAt ? String(t.openedAt) : undefined}>
                        {formatPaperDateTime(t.openedAt)}
                      </td>
                      <td className="muted" title={t.closedAt ? String(t.closedAt) : undefined}>
                        {formatPaperDateTime(t.closedAt)}
                      </td>
                      <td className="muted">{t.exitReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="dashboard-card" style={{ marginTop: 24 }}>
        <h2 className="dashboard-card-title">Stored history (monthly)</h2>
        <p className="muted" style={{ marginBottom: 12, fontSize: '0.85rem' }}>
          Exit month uses the <strong>close</strong> time. IST = Asia/Kolkata calendar month; UTC = UTC calendar month.
        </p>
        <div className="dashboard-toolbar" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted" style={{ fontSize: '0.8rem' }}>Month TZ</span>
            <select
              className="bot-live-input"
              style={{ width: 100 }}
              value={historyTz}
              onChange={(e) => {
                setHistoryTz(e.target.value);
                setDbTrades(null);
              }}
            >
              <option value="ist">IST</option>
              <option value="utc">UTC</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted" style={{ fontSize: '0.8rem' }}>Year</span>
            <input
              type="number"
              className="bot-live-input"
              style={{ width: 90 }}
              min={2020}
              max={2100}
              value={historyYear}
              onChange={(e) => {
                const v = Number(e.target.value);
                setHistoryYear(Number.isFinite(v) ? Math.floor(v) : new Date().getFullYear());
              }}
            />
          </label>
          <button type="button" className="btn-secondary" onClick={loadDbByMonth} disabled={dbLoading}>
            {dbLoading ? '…' : 'Refresh summary'}
          </button>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted" style={{ fontSize: '0.8rem' }}>Month YYYY-MM</span>
            <input
              className="bot-live-input"
              style={{ width: 110 }}
              placeholder="2026-03"
              value={historyMonth}
              onChange={(e) => setHistoryMonth(e.target.value.trim())}
            />
          </label>
          <button
            type="button"
            className="bot-live-button"
            onClick={() => loadDbTradesForMonth(historyMonth)}
            disabled={dbLoading || !/^\d{4}-\d{2}$/.test(historyMonth)}
          >
            Load trades
          </button>
        </div>
        {dbMessage && <p className="muted" style={{ marginBottom: 8, fontSize: '0.8rem' }}>{dbMessage}</p>}

        {dbByMonth?.months?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h3 className="dashboard-card-title" style={{ fontSize: '0.95rem' }}>Summary by exit month</h3>
            <p className="muted" style={{ fontSize: '0.75rem', marginBottom: 8 }}>
              Click a month to load full trade rows below.
            </p>
            <div className="dashboard-table-wrap" style={{ maxHeight: 240 }}>
              <table className="dashboard-table" style={{ fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th>Month ({historyTz.toUpperCase()})</th>
                    <th>Trades</th>
                    <th>Win rate</th>
                    <th>Total P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {dbByMonth.months.map((m) => (
                    <tr
                      key={m.month}
                      style={{ cursor: 'pointer' }}
                      onClick={() => loadDbTradesForMonth(m.month)}
                    >
                      <td><strong>{m.month}</strong></td>
                      <td>{m.tradeCount}</td>
                      <td>{(m.winRate * 100).toFixed(1)}%</td>
                      <td style={{ color: m.totalPnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        ₹{Number(m.totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {dbTrades?.trades?.length > 0 && (
          <div>
            <h3 className="dashboard-card-title" style={{ fontSize: '0.95rem' }}>
              Trades — {historyMonth} ({dbTrades.total ?? dbTrades.trades.length} total)
            </h3>
            <div className="dashboard-table-wrap" style={{ maxHeight: 480 }}>
              <table className="dashboard-table" style={{ fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    <th>Setup</th>
                    <th>Symbol</th>
                    <th>Qty</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>P&amp;L</th>
                    <th>Closed</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {dbTrades.trades.map((t) => (
                    <tr key={t._id}>
                      <td>{t.setupId}</td>
                      <td>{t.tradingsymbol || t.symbol}</td>
                      <td>{t.qty}</td>
                      <td>{Number(t.entryPrice).toFixed(2)}</td>
                      <td>{Number(t.exitPrice).toFixed(2)}</td>
                      <td style={{ color: (t.realizedPnl ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        ₹{Number(t.realizedPnl).toFixed(2)}
                      </td>
                      <td
                        className="muted"
                        title={t.closedAt ? String(t.closedAt) : undefined}
                      >
                        {formatPaperDateTime(t.closedAt, historyTz === 'utc' ? 'UTC' : 'Asia/Kolkata')}
                      </td>
                      <td>
                        <details>
                          <summary style={{ cursor: 'pointer' }}>JSON</summary>
                          <pre
                            className="muted"
                            style={{
                              marginTop: 6,
                              fontSize: '0.65rem',
                              maxWidth: 520,
                              overflow: 'auto',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {JSON.stringify(
                              {
                                exitReason: t.exitReason,
                                exitMonthUtc: t.exitMonthUtc,
                                exitMonthIst: t.exitMonthIst,
                                orderValueInr: t.orderValueInr,
                                initialCapitalSnapshot: t.initialCapitalSnapshot,
                                investedAmount: t.investedAmount,
                                proceedsAmount: t.proceedsAmount,
                                returnPct: t.returnPct,
                                entrySnapshot: t.entrySnapshot,
                                exitSnapshot: t.exitSnapshot,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {dbByMonth && (!dbByMonth.months || dbByMonth.months.length === 0) && !dbMessage && !dbLoading && (
          <p className="muted" style={{ fontSize: '0.85rem' }}>No closed paper trades stored for this year yet.</p>
        )}
      </div>
    </div>
  );
}
