import { useState, useEffect, useCallback } from 'react';
import {
  getPaperSetups,
  getPaperState,
  resetPaperPortfolio,
  previewPaperSetup,
  paperTick,
  paperClose,
  getPaperTrades,
  getPaperTradesByMonth,
} from '../api/paperTrading';

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

  const setupMeta = setups.find((s) => s.id === setupId);

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

  useEffect(() => {
    loadSetups();
    loadState();
  }, [loadSetups, loadState]);

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

  return (
    <div className="paper-trading-panel">
      <div className="dashboard-card">
        <h2 className="dashboard-card-title">Paper trading</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Virtual orders from the same setup logic as the backtest hub (stored DB candles). One open long per setup + symbol.
          EMA crossover uses 1H candles and can emit SELL to close. Other setups: use <strong>Close at last price</strong> or tick again when your rules say exit.
          Live cash/positions reset on <strong>Reset portfolio</strong> or server restart; <strong>closed</strong> trades are saved to MongoDB with entry/exit snapshots and month buckets (IST or UTC).
        </p>

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
            <div className="dashboard-table-wrap" style={{ maxHeight: 220 }}>
              <table className="dashboard-table" style={{ fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th>Setup</th>
                    <th>Symbol</th>
                    <th>Qty</th>
                    <th>Entry</th>
                    <th>Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {state.positions.map((p) => (
                    <tr key={p.id}>
                      <td>{p.setupId}</td>
                      <td>{p.tradingsymbol || p.symbol}</td>
                      <td>{p.qty}</td>
                      <td>{Number(p.entryPrice).toFixed(2)}</td>
                      <td className="muted">{p.openedAt?.slice(0, 19) ?? '—'}</td>
                    </tr>
                  ))}
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
                      <td className="muted">{t.closedAt?.slice?.(0, 19) ?? '—'}</td>
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
