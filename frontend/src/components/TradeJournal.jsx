import { useState, useEffect } from 'react';
import { getTrades } from '../api/trades';

function formatDate(ts) {
  if (!ts) return '–';
  try {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '–' : d.toLocaleString();
  } catch {
    return '–';
  }
}

function formatNum(n) {
  if (n == null || !Number.isFinite(n)) return '–';
  return Number(n).toFixed(2);
}

export function TradeJournal() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    setLoading(true);
    try {
      const data = await getTrades();
      setTrades(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message ?? 'Failed to load trades');
      setTrades([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return <p className="hint">Loading trades…</p>;
  }

  if (error) {
    return (
      <div>
        <p className="error">{error}</p>
        <button type="button" onClick={load} className="bot-live-btn">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="trade-journal">
      <div className="trade-journal-header">
        <button type="button" onClick={load} className="bot-live-btn">
          Refresh
        </button>
      </div>
      <div className="trade-journal-table-wrap">
        <table className="trade-journal-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Symbol</th>
              <th>Strategy</th>
              <th>Side</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>PnL</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan={8} className="trade-journal-empty">
                  No trades yet
                </td>
              </tr>
            ) : (
              trades.map((t) => (
                <tr key={t._id}>
                  <td>{formatDate(t.timestamp)}</td>
                  <td>{t.symbol ?? '–'}</td>
                  <td>{t.strategyName ?? '–'}</td>
                  <td>{t.side ?? '–'}</td>
                  <td>{formatNum(t.entryPrice)}</td>
                  <td>{formatNum(t.exitPrice)}</td>
                  <td>
                    <span
                      className={
                        t.pnl != null && Number(t.pnl) > 0
                          ? 'trade-journal-pnl positive'
                          : t.pnl != null && Number(t.pnl) < 0
                            ? 'trade-journal-pnl negative'
                            : 'trade-journal-pnl'
                      }
                    >
                      {formatNum(t.pnl)}
                    </span>
                  </td>
                  <td>{t.status ?? '–'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
