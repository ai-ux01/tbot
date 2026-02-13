import { useState } from 'react';
import { useSession } from '../context/SessionContext';
import { getQuotes, getScripmasterPaths } from '../api/kotak';

export function QuotesExample() {
  const { accessToken, session } = useSession();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [symbol, setSymbol] = useState('26000');
  const [exchangeSegment, setExchangeSegment] = useState('nse_cm');
  const [tab, setTab] = useState('quotes');

  const baseUrl = session?.baseUrl || '';

  const run = async (fn) => {
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const data = await fn();
      setResult(data);
    } catch (err) {
      setError(err.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const fetchQuotes = (e) => {
    e?.preventDefault();
    if (!accessToken) {
      setError('Set access token first (Quotes use only Authorization)');
      return;
    }
    if (!baseUrl) {
      setError('Log in to get baseUrl; Quotes need baseUrl + access token');
      return;
    }
    run(() => getQuotes(accessToken, baseUrl, exchangeSegment, symbol));
  };

  const fetchScripmaster = (e) => {
    e?.preventDefault();
    if (!accessToken) {
      setError('Set access token first');
      return;
    }
    if (!baseUrl) {
      setError('Log in to get baseUrl');
      return;
    }
    run(() => getScripmasterPaths(accessToken, baseUrl));
  };

  return (
    <div className="quotes-panel">
      <p className="hint">Quotes and Scripmaster use only Authorization header (no Auth/Sid/neo-fin-key).</p>
      <div className="tabs">
        <button
          type="button"
          className={tab === 'quotes' ? 'active' : ''}
          onClick={() => setTab('quotes')}
        >
          Quotes
        </button>
        <button
          type="button"
          className={tab === 'scripmaster' ? 'active' : ''}
          onClick={() => setTab('scripmaster')}
        >
          Scripmaster paths
        </button>
      </div>

      {tab === 'quotes' && (
        <form onSubmit={fetchQuotes}>
          <input
            type="text"
            placeholder="Exchange segment (e.g. nse_cm)"
            value={exchangeSegment}
            onChange={(e) => setExchangeSegment(e.target.value)}
          />
          <input
            type="text"
            placeholder="Symbol (e.g. 26000 or neosymbol)"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Loading…' : 'Get quotes'}
          </button>
        </form>
      )}

      {tab === 'scripmaster' && (
        <button type="button" onClick={fetchScripmaster} disabled={loading}>
          {loading ? 'Loading…' : 'Get scripmaster file-paths'}
        </button>
      )}

      {error && <p className="error">{error}</p>}
      {result && (
        <pre className="result">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}
