import { useState, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import {
  postRsiSetupBacktest,
  getRsiSetupBacktestCombined,
  postEightyPercentBacktest,
  getEightyPercentBacktestCombined,
  postRsiMaSetupCopyBacktest,
  getRsiMaSetupCopyBacktestCombined,
  getEmaCrossoverBacktest,
} from '../api/signals';
import {
  RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT,
  RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT,
  RSI_MA_COPY_DEFAULT_PARTIAL_EXIT_QTY_PERCENT,
} from '../utils/rsiMaSetupCopy';

const SETUPS = [
  { id: 'rsi-setup', label: 'RSI Setup (momentum reset)', hasSeries: false, hasEmaCapital: false },
  { id: 'rsi-dma', label: 'RSI↓MA Setup', hasSeries: true, hasEmaCapital: false },
  { id: 'rsi-dma-copy', label: 'RSI↓MA Setup (copy)', hasSeries: true, hasEmaCapital: false },
  { id: 'ema-crossover', label: 'EMA 10/20 crossover (1D)', hasSeries: false, hasEmaCapital: true },
];

function summaryLine(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.summary) {
    const s = data.summary;
    const parts = [];
    if (s.totalTrades != null) parts.push(`Trades: ${s.totalTrades}`);
    if (s.winRate != null) parts.push(`Win rate: ${(s.winRate * 100).toFixed(1)}%`);
    if (s.totalPnl != null) parts.push(`P&L: ${Number(s.totalPnl).toFixed(2)}`);
    if (s.totalPnL != null) parts.push(`P&L: ${Number(s.totalPnL).toFixed(2)}`);
    if (s.symbolsProcessed != null) parts.push(`Symbols: ${s.symbolsProcessed}`);
    if (s.totalSymbols != null) parts.push(`Symbols: ${s.totalSymbols}`);
    return parts.length ? parts.join(' · ') : null;
  }
  if (data.tradesCount != null) {
    const parts = [`Trades: ${data.tradesCount}`];
    if (data.winRate != null) parts.push(`Win: ${(data.winRate * 100).toFixed(1)}%`);
    if (data.totalReturn != null) parts.push(`Return: ${(data.totalReturn * 100).toFixed(2)}%`);
    return parts.join(' · ');
  }
  if (Array.isArray(data.results) && data.totalPnL != null) {
    return `Symbols in result: ${data.results.length}`;
  }
  return null;
}

export function BacktestHubPanel() {
  const [setupId, setSetupId] = useState('rsi-dma');
  const [mode, setMode] = useState('single');
  const [symbol, setSymbol] = useState('');
  const [maxHoldingDays, setMaxHoldingDays] = useState(10);
  const [series, setSeries] = useState('day');
  const [limit, setLimit] = useState(200);
  const [capital, setCapital] = useState(10000);
  const [profitTargetPctInput, setProfitTargetPctInput] = useState(
    RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT,
  );
  const [rsiRemainderExitInput, setRsiRemainderExitInput] = useState(
    RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT,
  );
  const [partialExitQtyPercent, setPartialExitQtyPercent] = useState(RSI_MA_COPY_DEFAULT_PARTIAL_EXIT_QTY_PERCENT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const setupMeta = SETUPS.find((s) => s.id === setupId) ?? SETUPS[0];

  const run = useCallback(async () => {
    setError(null);
    setResult(null);
    const sym = symbol.trim();
    if (mode === 'single' && setupId !== 'ema-crossover' && !sym) {
      setError('Enter a symbol for single-symbol backtest.');
      return;
    }
    if (mode === 'single' && setupId === 'ema-crossover' && !sym) {
      setError('Enter a symbol for EMA crossover single backtest.');
      return;
    }
    setLoading(true);
    try {
      let data;
      if (setupId === 'rsi-setup') {
        if (mode === 'single') {
          data = await postRsiSetupBacktest({ symbol: sym, maxHoldingDays });
        } else {
          data = await getRsiSetupBacktestCombined({ limit, maxHoldingDays });
        }
      } else if (setupId === 'rsi-dma') {
        if (mode === 'single') {
          data = await postEightyPercentBacktest({ symbol: sym, maxHoldingDays, series });
        } else {
          data = await getEightyPercentBacktestCombined({ limit, maxHoldingDays, series });
        }
      } else if (setupId === 'rsi-dma-copy') {
        const copyExit = {
          profitTargetPct: profitTargetPctInput,
          rsiRemainderExit: rsiRemainderExitInput,
          partialTpFraction: partialExitQtyPercent,
        };
        if (mode === 'single') {
          data = await postRsiMaSetupCopyBacktest({ symbol: sym, maxHoldingDays, series, ...copyExit });
        } else {
          data = await getRsiMaSetupCopyBacktestCombined({ limit, maxHoldingDays, series, ...copyExit });
        }
      } else if (setupId === 'ema-crossover') {
        const params = { timeframe: 'day', capital };
        if (mode === 'single') {
          params.symbol = sym;
        } else {
          params.limit = limit;
        }
        data = await getEmaCrossoverBacktest(params);
      } else {
        throw new Error('Unknown setup');
      }
      setResult(data);
    } catch (e) {
      setError(e?.message ?? 'Backtest failed');
    } finally {
      setLoading(false);
    }
  }, [setupId, mode, symbol, maxHoldingDays, series, limit, capital, profitTargetPctInput, rsiRemainderExitInput, partialExitQtyPercent]);

  return (
    <div className="backtest-hub-panel">
      <div className="dashboard-card">
        <h2 className="dashboard-card-title">Backtest hub</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Run a quick backtest for any supported setup. For full options (filters, monthly bars UI, trade tables), use the
          dedicated pages:{' '}
          <NavLink to="/rsi-setup">RSI Setup</NavLink>
          {' · '}
          <NavLink to="/eighty-percent">RSI↓MA Setup</NavLink>
          {' · '}
          <NavLink to="/rsi-ma-setup-copy">RSI↓MA (copy)</NavLink>.
        </p>

        <div className="dashboard-toolbar" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted" style={{ fontSize: '0.8rem' }}>Setup</span>
            <select
              className="bot-live-input"
              style={{ minWidth: 220 }}
              value={setupId}
              onChange={(e) => setSetupId(e.target.value)}
            >
              {SETUPS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" name="hubMode" checked={mode === 'single'} onChange={() => setMode('single')} />
              <span>Single symbol</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" name="hubMode" checked={mode === 'all'} onChange={() => setMode('all')} />
              <span>All symbols</span>
            </label>
          </div>
          {mode === 'single' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="muted" style={{ fontSize: '0.8rem' }}>Symbol</span>
              <input
                className="bot-live-input"
                style={{ width: 160 }}
                placeholder="e.g. RELIANCE"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && run()}
              />
            </label>
          )}
          {mode === 'all' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="muted" style={{ fontSize: '0.8rem' }}>Symbol limit</span>
              <input
                type="number"
                min={1}
                max={5000}
                className="bot-live-input"
                style={{ width: 90 }}
                value={limit}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setLimit(Number.isFinite(v) && v >= 1 ? Math.min(5000, Math.floor(v)) : 200);
                }}
              />
            </label>
          )}
          {setupId !== 'ema-crossover' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="muted" style={{ fontSize: '0.8rem' }}>Max holding (days)</span>
              <input
                type="number"
                min={1}
                className="bot-live-input"
                style={{ width: 72 }}
                value={maxHoldingDays}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setMaxHoldingDays(Number.isFinite(v) && v >= 1 ? Math.floor(v) : 10);
                }}
              />
            </label>
          )}
          {setupMeta.hasSeries && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="muted" style={{ fontSize: '0.8rem' }}>Bars</span>
              <select className="bot-live-input" style={{ width: 100 }} value={series} onChange={(e) => setSeries(e.target.value)}>
                <option value="day">Daily</option>
                <option value="month">Monthly</option>
              </select>
            </label>
          )}
          {setupId === 'rsi-dma-copy' && (
            <div
              className="rsi-ma-copy-exit-filters"
              style={{
                flex: '1 1 100%',
                width: '100%',
                maxWidth: '100%',
                boxSizing: 'border-box',
                marginBottom: 0,
              }}
            >
              <p className="rsi-ma-copy-exit-filters-heading">RSI↓MA (copy) exit filters</p>
              <div className="rsi-ma-copy-exit-filters-row">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span
                    className="muted"
                    style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}
                    title={`Default RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PCT → ${RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT}%`}
                  >
                    Partial TP %
                  </span>
                  <input
                    type="number"
                    min={0.5}
                    max={500}
                    step={0.5}
                    className="bot-live-input"
                    style={{ width: 80 }}
                    value={profitTargetPctInput}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setProfitTargetPctInput(
                        Number.isFinite(v) && v > 0 ? v : RSI_MA_COPY_DEFAULT_PROFIT_TARGET_PERCENT_INPUT,
                      );
                    }}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span className="muted" style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>Remainder RSI</span>
                  <input
                    type="number"
                    min={5}
                    max={95}
                    step={1}
                    className="bot-live-input"
                    style={{ width: 64 }}
                    value={rsiRemainderExitInput}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setRsiRemainderExitInput(
                        Number.isFinite(v)
                          ? Math.round(Math.min(95, Math.max(5, v)))
                          : RSI_MA_COPY_DEFAULT_RSI_REMAINDER_EXIT,
                      );
                    }}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span className="muted" style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>Exit at 1st TP</span>
                  <select
                    className="bot-live-input"
                    style={{ minWidth: 130 }}
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
                  }}
                >
                  Reset defaults
                </button>
              </div>
            </div>
          )}
          {setupMeta.hasEmaCapital && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="muted" style={{ fontSize: '0.8rem' }}>Capital</span>
              <input
                type="number"
                min={100}
                className="bot-live-input"
                style={{ width: 100 }}
                value={capital}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setCapital(Number.isFinite(v) && v > 0 ? v : 10000);
                }}
              />
            </label>
          )}
          <button type="button" className="bot-live-button" onClick={run} disabled={loading}>
            {loading ? 'Running…' : 'Run backtest'}
          </button>
        </div>

        {error && <p className="bot-live-error" style={{ marginBottom: 12 }}>{error}</p>}

        {result && (
          <div style={{ marginTop: 8 }}>
            {summaryLine(result) && (
              <p className="muted" style={{ marginBottom: 8, fontSize: '0.9rem' }}>
                <strong>Summary:</strong> {summaryLine(result)}
              </p>
            )}
            <details open className="backtest-details-dropdown">
              <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>Raw response</summary>
              <pre
                className="muted"
                style={{
                  marginTop: 8,
                  fontSize: '0.72rem',
                  overflow: 'auto',
                  maxHeight: 'min(60vh, 480px)',
                  padding: 12,
                  background: 'var(--bg-secondary)',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
