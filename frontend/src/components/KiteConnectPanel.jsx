import { useState, useEffect } from 'react';
import { getKiteLoginUrl, getKiteProfile, getKiteHistorical, getKiteInstruments, filterNseDisplayInstruments, kiteLogout, setStoredKiteSessionId, getStoredKiteSessionId, completeKiteLogin } from '../api/kite';

const INTERVALS = ['minute', '3minute', '5minute', '10minute', '15minute', '30minute', '60minute', 'day'];

function formatDate(d) {
  if (!d) return '';
  const date = typeof d === 'number' ? new Date(d) : new Date(d);
  return isNaN(date.getTime()) ? '' : date.toLocaleString();
}

/** Convert "yyyy-mm-dd hh:mm:ss" to datetime-local value "yyyy-mm-ddThh:mm" */
function toDateTimeLocalValue(str) {
  if (!str || typeof str !== 'string') return '';
  const s = str.trim().slice(0, 16);
  return s.includes(' ') ? s.replace(' ', 'T') : s;
}

/** Convert datetime-local value "yyyy-mm-ddThh:mm" or "yyyy-mm-ddThh:mm:ss" to API format "yyyy-mm-dd hh:mm:ss" */
function fromDateTimeLocalValue(val) {
  if (!val || typeof val !== 'string') return '';
  const s = val.trim().replace('T', ' ');
  if (s.length <= 16) return s + ':00';
  return s.slice(0, 19);
}

export function KiteConnectPanel() {
  const [status, setStatus] = useState('loading'); // 'loading' | 'connected' | 'disconnected'
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [historical, setHistorical] = useState({ candles: null, loading: false, err: null });
  const [instruments, setInstruments] = useState({ list: [], loading: false, err: null, search: '', exchange: '' });
  const [histForm, setHistForm] = useState({
    instrumentToken: '5633',
    interval: 'minute',
    from: '',
    to: '',
    continuous: 0,
    oi: 0,
  });

  const emitKiteProfileToHeader = (profileData) => {
    const userName = profileData
      ? (profileData.user_name ?? profileData.user_id ?? null)
      : null;
    window.dispatchEvent(new CustomEvent('kite-connect-profile', { detail: { userName } }));
  };

  const checkKiteSession = async (sessionIdOverride = null) => {
    try {
      const data = await getKiteProfile(sessionIdOverride);
      const profileData = data?.data ?? data;
      setProfile(profileData);
      setStatus('connected');
      setError(null);
      emitKiteProfileToHeader(profileData);
    } catch (e) {
      setProfile(null);
      setStatus('disconnected');
      emitKiteProfileToHeader(null);
      if (e?.code !== 'KITE_SESSION_EXPIRED') setError(e?.message ?? 'Not connected');
      else setError(null);
    }
  };

  useEffect(() => {
    const search = window.location.search || (window.location.hash && window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '');
    const params = new URLSearchParams(search);
    const kite = params.get('kite');
    const kiteSid = params.get('kite_sid');
    const requestToken = params.get('request_token');
    const status = params.get('status');
    const action = params.get('action');

    const KITE_PARAMS = ['kite', 'kite_sid', 'request_token', 'status', 'action', 'reason'];
    const cleanUrl = () => {
      const search = window.location.search || '';
      const hash = window.location.hash || '';
      const hashParts = hash.split('?');
      const hashBeforeQ = hashParts[0] || '';
      const hashQuery = hashParts[1] || '';
      const qSearch = new URLSearchParams(search);
      const qHash = new URLSearchParams(hashQuery);
      KITE_PARAMS.forEach((k) => {
        qSearch.delete(k);
        qHash.delete(k);
      });
      const newSearch = qSearch.toString();
      const newHashQuery = qHash.toString();
      const newHash = newHashQuery ? `${hashBeforeQ}?${newHashQuery}` : hashBeforeQ;
      const clean = window.location.pathname + (newSearch ? `?${newSearch}` : '') + (newHash ? newHash : '');
      window.history.replaceState({}, '', clean);
    };

    if (requestToken && status === 'success' && action === 'login') {
      completeKiteLogin(requestToken)
        .then((data) => {
          if (data.kite_sid) {
            setStoredKiteSessionId(data.kite_sid);
            cleanUrl();
            checkKiteSession(data.kite_sid);
          }
        })
        .catch((e) => {
          cleanUrl();
          setError(e?.message ?? 'Could not complete Kite login.');
          setStatus('disconnected');
        });
      return;
    }

    const kiteFailures = ['error', 'exchange_failed', 'no_token', 'config_error'];
    if (kite === 'success' || kiteFailures.includes(kite)) {
      if (kite === 'success' && kiteSid) {
        const sid = decodeURIComponent(kiteSid);
        setStoredKiteSessionId(sid);
        cleanUrl();
        checkKiteSession(sid);
      } else if (kite === 'success' && !kiteSid) {
        setError('Session not received. In Kite app set Redirect URL to: http://localhost:4000/api/kite/callback — then try Login with Kite again.');
        cleanUrl();
      } else if (kiteFailures.includes(kite)) {
        let reasonText = '';
        try {
          const r = params.get('reason');
          if (r) reasonText = decodeURIComponent(r);
        } catch (_) {}
        cleanUrl();
        const messages = {
          error: 'Login was cancelled or Kite did not return to the app. In Zerodha Kite app set Redirect URL to: http://localhost:4000/api/kite/callback then try again.',
          exchange_failed: 'Token exchange failed. Check KITE_API_SECRET and that Redirect URL in Kite app matches exactly: http://localhost:4000/api/kite/callback.',
          no_token: 'Kite did not return an access token. Try logging in with Kite again.',
          config_error: 'Kite is not configured. Set KITE_API_KEY and KITE_API_SECRET in backend .env (see .env.example).',
        };
        let msg = messages[kite] || 'Kite login failed.';
        if (kite === 'exchange_failed' && reasonText) msg += ` — ${reasonText}`;
        setError(msg);
      }
    } else {
      if (getStoredKiteSessionId()) checkKiteSession();
      else setStatus('disconnected');
    }
  }, []);

  const handleLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      const { loginUrl } = await getKiteLoginUrl();
      window.location.href = loginUrl;
      return;
    } catch (e) {
      const msg = e?.message ?? 'Could not get login URL';
      setError(e?.hint ? `${msg}. ${e.hint}` : msg);
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setError(null);
    setBusy(true);
    try {
      await kiteLogout();
      setProfile(null);
      emitKiteProfileToHeader(null);
      setStatus('disconnected');
      setHistorical({ candles: null, loading: false, err: null });
    } catch (e) {
      setError(e?.message ?? 'Logout failed');
    } finally {
      setBusy(false);
    }
  };

  const handleFetchHistorical = async () => {
    setHistorical({ candles: null, loading: true, err: null });
    try {
      const data = await getKiteHistorical({
        instrumentToken: histForm.instrumentToken.trim(),
        interval: histForm.interval,
        from: histForm.from.trim(),
        to: histForm.to.trim(),
        options: { continuous: histForm.continuous ? 1 : 0, oi: histForm.oi ? 1 : 0 },
      });
      setHistorical({ candles: data.candles ?? [], loading: false, err: null });
    } catch (e) {
      if (e?.code === 'KITE_SESSION_EXPIRED') {
        setStatus('disconnected');
        setProfile(null);
      }
      setHistorical({ candles: null, loading: false, err: e?.message ?? 'Fetch failed' });
    }
  };

  const handleLoadInstruments = async () => {
    setInstruments((prev) => ({ ...prev, loading: true, err: null }));
    try {
      const exchange = instruments.exchange?.trim() || null;
      const data = await getKiteInstruments(exchange);
      const list = data.instruments ?? [];
      const filtered = exchange === 'NSE' ? filterNseDisplayInstruments(list) : list;
      setInstruments((prev) => ({ ...prev, list: filtered, loading: false, err: null }));
    } catch (e) {
      if (e?.code === 'KITE_SESSION_EXPIRED') {
        setStatus('disconnected');
        setProfile(null);
      }
      setInstruments((prev) => ({ ...prev, loading: false, err: e?.message ?? 'Failed to load instruments' }));
    }
  };

  const instrumentList = instruments.list || [];
  const searchLower = (instruments.search || '').toLowerCase().trim();
  const filteredInstruments = searchLower
    ? instrumentList.filter(
        (row) =>
          String(row.tradingsymbol || '').toLowerCase().includes(searchLower) ||
          String(row.name || '').toLowerCase().includes(searchLower) ||
          String(row.instrument_token || '').includes(searchLower),
      )
    : instrumentList;
  const showInstruments = filteredInstruments.slice(0, 200);

  if (status === 'loading') {
    return (
      <div className="kite-panel">
        <p className="muted">Checking Kite connection…</p>
      </div>
    );
  }

  return (
    <div className="kite-panel">
      <h3 style={{ fontSize: '0.9rem', margin: '0 0 8px', color: '#8b98a5' }}>Kite Connect</h3>
      {status === 'disconnected' ? (
        <>
          <p className="muted" style={{ fontSize: '0.85em', marginBottom: 10 }}>
            Connect your Zerodha Kite account. You will be redirected to Kite to sign in, then back here.
          </p>
          <button type="button" onClick={handleLogin} disabled={busy} className="bot-live-btn">
            {busy ? '…' : 'Login with Kite'}
          </button>
        </>
      ) : (
        <>
          {profile && (
            <p style={{ margin: '0 0 8px', fontSize: '0.9rem' }}>
              {profile.user_name ?? profile.user_id ?? 'Connected'}
            </p>
          )}
          <button type="button" onClick={handleLogout} disabled={busy} className="bot-live-btn" style={{ marginBottom: 12 }}>
            {busy ? '…' : 'Logout Kite'}
          </button>

          {/* <div className="kite-historical" style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #2f3336' }}>
            <h4 style={{ fontSize: '0.85rem', margin: '0 0 8px', color: '#8b98a5' }}>Instruments</h4>
            <p className="muted" style={{ fontSize: '0.8em', marginBottom: 8 }}>Load instrument list, then search and select for historical data</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <select
                value={instruments.exchange}
                onChange={(e) => setInstruments((p) => ({ ...p, exchange: e.target.value }))}
                className="bot-live-input"
                style={{ minWidth: 80 }}
              >
                <option value="">All</option>
                <option value="NSE">NSE</option>
                <option value="NFO">NFO</option>
                <option value="BSE">BSE</option>
                <option value="MCX">MCX</option>
              </select>
              <button
                type="button"
                onClick={handleLoadInstruments}
                disabled={instruments.loading}
                className="bot-live-btn"
              >
                {instruments.loading ? 'Loading…' : 'Load instruments'}
              </button>
              {instrumentList.length > 0 && (
                <input
                  type="text"
                  value={instruments.search}
                  onChange={(e) => setInstruments((p) => ({ ...p, search: e.target.value }))}
                  placeholder="Search symbol or name…"
                  className="bot-live-input"
                  style={{ minWidth: 160 }}
                />
              )}
            </div>
            {instruments.err && <p className="bot-live-error" style={{ marginBottom: 8 }}>{instruments.err}</p>}
            {instrumentList.length > 0 && (
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #2f3336', borderRadius: 4, marginBottom: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#1a1d21' }}>
                    <tr style={{ borderBottom: '1px solid #2f3336' }}>
                      <th style={{ textAlign: 'right', padding: '4px 6px', width: 40 }}>#</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Token</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Symbol</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Name</th>
                      <th style={{ textAlign: 'left', padding: '4px 6px' }}>Exchange</th>
                    </tr>
                  </thead>
                  <tbody>
                    {showInstruments.map((row, i) => (
                      <tr
                        key={row.instrument_token + '-' + i}
                        style={{ borderBottom: '1px solid #2f3336', cursor: 'pointer' }}
                        onClick={() => setHistForm((f) => ({ ...f, instrumentToken: String(row.instrument_token ?? '') }))}
                      >
                        <td style={{ padding: '4px 6px', textAlign: 'right', color: '#8b98a5' }}>{i + 1}</td>
                        <td style={{ padding: '4px 6px' }}>{row.instrument_token}</td>
                        <td style={{ padding: '4px 6px' }}>{row.tradingsymbol}</td>
                        <td style={{ padding: '4px 6px' }}>{row.name || '–'}</td>
                        <td style={{ padding: '4px 6px' }}>{row.exchange}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredInstruments.length > 200 && (
                  <p className="muted" style={{ margin: '4px 8px', fontSize: '0.75rem' }}>Showing 200 of {filteredInstruments.length} — narrow search</p>
                )}
              </div>
            )}

            <h4 style={{ fontSize: '0.85rem', margin: '16px 0 8px', color: '#8b98a5' }}>Historical candles</h4>
            <p className="muted" style={{ fontSize: '0.8em', marginBottom: 8 }}>Instrument token, interval, and date range</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <input
                type="text"
                value={histForm.instrumentToken}
                onChange={(e) => setHistForm((f) => ({ ...f, instrumentToken: e.target.value }))}
                placeholder="Instrument token (or select above)"
                className="bot-live-input"
                style={{ minWidth: 100 }}
              />
              <select
                value={histForm.interval}
                onChange={(e) => setHistForm((f) => ({ ...f, interval: e.target.value }))}
                className="bot-live-input"
                style={{ minWidth: 100 }}
              >
                {INTERVALS.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <label style={{ fontSize: '0.75rem', color: '#8b98a5' }}>From</label>
                <input
                  type="datetime-local"
                  value={toDateTimeLocalValue(histForm.from)}
                  onChange={(e) => setHistForm((f) => ({ ...f, from: fromDateTimeLocalValue(e.target.value) }))}
                  className="bot-live-input"
                  style={{ minWidth: 180 }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <label style={{ fontSize: '0.75rem', color: '#8b98a5' }}>To</label>
                <input
                  type="datetime-local"
                  value={toDateTimeLocalValue(histForm.to)}
                  onChange={(e) => setHistForm((f) => ({ ...f, to: fromDateTimeLocalValue(e.target.value) }))}
                  className="bot-live-input"
                  style={{ minWidth: 180 }}
                />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={histForm.oi === 1}
                onChange={(e) => setHistForm((f) => ({ ...f, oi: e.target.checked ? 1 : 0 }))}
              />
              Include OI
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={histForm.continuous === 1}
                onChange={(e) => setHistForm((f) => ({ ...f, continuous: e.target.checked ? 1 : 0 }))}
              />
              Continuous (futures)
            </label>
            <button
              type="button"
              onClick={handleFetchHistorical}
              disabled={historical.loading || !histForm.from || !histForm.to}
              className="bot-live-btn"
            >
              {historical.loading ? 'Fetching…' : 'Fetch candles'}
            </button>
            {historical.err && <p className="bot-live-error" style={{ marginTop: 8 }}>{historical.err}</p>}
            {historical.candles && (
              <div style={{ marginTop: 12, fontSize: '0.8rem' }}>
                <p className="muted" style={{ margin: '0 0 6px' }}>{historical.candles.length} candle(s)</p>
                <div style={{ overflowX: 'auto', maxHeight: 200, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2f3336' }}>
                        <th style={{ textAlign: 'left', padding: '4px 6px' }}>Time</th>
                        <th style={{ textAlign: 'right', padding: '4px 6px' }}>O</th>
                        <th style={{ textAlign: 'right', padding: '4px 6px' }}>H</th>
                        <th style={{ textAlign: 'right', padding: '4px 6px' }}>L</th>
                        <th style={{ textAlign: 'right', padding: '4px 6px' }}>C</th>
                        <th style={{ textAlign: 'right', padding: '4px 6px' }}>Vol</th>
                        {histForm.oi ? <th style={{ textAlign: 'right', padding: '4px 6px' }}>OI</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {(historical.candles.slice(0, 50)).map((c, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #2f3336' }}>
                          <td style={{ padding: '4px 6px' }}>{formatDate(c.timestamp)}</td>
                          <td style={{ textAlign: 'right', padding: '4px 6px' }}>{c.open}</td>
                          <td style={{ textAlign: 'right', padding: '4px 6px' }}>{c.high}</td>
                          <td style={{ textAlign: 'right', padding: '4px 6px' }}>{c.low}</td>
                          <td style={{ textAlign: 'right', padding: '4px 6px' }}>{c.close}</td>
                          <td style={{ textAlign: 'right', padding: '4px 6px' }}>{c.volume}</td>
                          {histForm.oi ? <td style={{ textAlign: 'right', padding: '4px 6px' }}>{c.oi ?? '–'}</td> : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {historical.candles.length > 50 && (
                  <p className="muted" style={{ margin: '4px 0 0' }}>Showing first 50 of {historical.candles.length}</p>
                )}
              </div>
            )}
          </div> */}
        </>
      )}
      {error && <p className="bot-live-error" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
