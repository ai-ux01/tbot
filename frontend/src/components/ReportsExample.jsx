import { useState } from 'react';
import { useSession } from '../context/SessionContext';
import { getTradeBook, getPositions, getHoldings, SESSION_EXPIRED_CODE } from '../api/kotak';

export function ReportsExample() {
  const { session, logout } = useSession();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState('trades');

  if (!session) {
    return <p className="hint">Log in first to view reports.</p>;
  }

  const run = async (fn) => {
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const data = await fn();
      setResult(data);
    } catch (err) {
      if (err.code === SESSION_EXPIRED_CODE) logout();
      setError(err.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const fetchReport = () => {
    if (report === 'trades') run(() => getTradeBook(session));
    else if (report === 'positions') run(() => getPositions(session));
    else if (report === 'holdings') run(() => getHoldings(session));
  };

  return (
    <div className="reports-panel">
      <div className="tabs">
        {['trades', 'positions', 'holdings'].map((r) => (
          <button
            key={r}
            type="button"
            className={report === r ? 'active' : ''}
            onClick={() => setReport(r)}
          >
            {r === 'trades' && 'Trade book'}
            {r === 'positions' && 'Positions'}
            {r === 'holdings' && 'Holdings'}
          </button>
        ))}
      </div>
      <button type="button" onClick={fetchReport} disabled={loading}>
        {loading ? 'Loading…' : `Fetch ${report}`}
      </button>
      {error && <p className="error">{error}</p>}
      {result && (
        <pre className="result">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}
