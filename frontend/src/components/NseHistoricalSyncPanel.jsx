import { useState, useEffect } from 'react';
import { syncNseHistorical, getKiteInstruments, getStoredKiteSessionId, filterNseDisplayInstruments } from '../api/kite';

const EQ = 'EQ';

export function NseHistoricalSyncPanel() {
  const [instruments, setInstruments] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [syncingToken, setSyncingToken] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncAllProgress, setSyncAllProgress] = useState({ current: 0, total: 0 });

  const hasSession = !!getStoredKiteSessionId();

  useEffect(() => {
    if (!hasSession) {
      setInstruments([]);
      return;
    }
    let cancelled = false;
    setListLoading(true);
    setError(null);
    getKiteInstruments('NSE')
      .then((data) => {
        if (cancelled) return;
        const eqList = (data.instruments || []).filter(
          (row) => String(row.instrument_type || '').toUpperCase() === EQ
        );
        setInstruments(filterNseDisplayInstruments(eqList));
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Failed to load instruments');
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => { cancelled = true; };
  }, [hasSession]);

  const filtered = search.trim()
    ? instruments.filter(
        (row) =>
          String(row.tradingsymbol || '')
            .toLowerCase()
            .includes(search.trim().toLowerCase()) ||
          String(row.name || '')
            .toLowerCase()
            .includes(search.trim().toLowerCase()) ||
          String(row.instrument_token ?? '')
            .includes(search.trim())
      )
    : instruments;

  const handleSyncOne = async (inst) => {
    const token = String(inst.instrument_token ?? '');
    if (!token) return;
    if (!hasSession) {
      setError('Connect Kite first (More → Kite Connect).');
      return;
    }
    setError(null);
    setLastResult(null);
    setSyncingToken(token);
    try {
      const data = await syncNseHistorical({ instrument_token: token });
      setLastResult({ ...data, tradingsymbol: inst.tradingsymbol, name: inst.name });
    } catch (e) {
      setError(e?.message ?? 'Sync failed');
      if (e?.code === 'KITE_SESSION_EXPIRED') setLastResult(null);
    } finally {
      setSyncingToken(null);
    }
  };

  const handleSyncAll = async () => {
    if (!hasSession || filtered.length === 0) return;
    setError(null);
    setLastResult(null);
    setSyncingAll(true);
    setSyncAllProgress({ current: 0, total: filtered.length });
    let lastSuccess = null;
    for (let i = 0; i < filtered.length; i++) {
      const inst = filtered[i];
      const token = String(inst.instrument_token ?? '');
      if (!token) continue;
      setSyncingToken(token);
      setSyncAllProgress((p) => ({ ...p, current: i + 1 }));
      try {
        const data = await syncNseHistorical({ instrument_token: token });
        lastSuccess = { ...data, tradingsymbol: inst.tradingsymbol, name: inst.name };
      } catch (e) {
        setError(e?.message ?? `Sync failed at ${inst.tradingsymbol ?? token}`);
        if (e?.code === 'KITE_SESSION_EXPIRED') {
          setLastResult(null);
          break;
        }
      }
      setSyncingToken(null);
    }
    setSyncingToken(null);
    setSyncingAll(false);
    if (lastSuccess) setLastResult(lastSuccess);
  };

  return (
    <div className="nse-sync-panel" style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: '1rem', margin: '0 0 8px', color: '#e7e9ea' }}>
        NSE historical sync
      </h2>
      <p className="muted" style={{ fontSize: '0.85em', marginBottom: 12 }}>
        List NSE equity stocks and sync 5 years 1D + 1H data when you click a stock. Requires Kite login and MongoDB.
      </p>
      {!hasSession && (
        <p className="bot-live-error" style={{ marginBottom: 12 }}>
          Not connected to Kite. Go to the More tab and log in with Kite first.
        </p>
      )}

      {hasSession && (
        <>
          <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search by name, symbol or instrument code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bot-live-input"
              style={{ width: '100%', maxWidth: 320 }}
            />
            <button
              type="button"
              className="bot-live-button"
              disabled={listLoading || syncingAll || filtered.length === 0}
              onClick={handleSyncAll}
              title={`Sync all ${filtered.length} visible stocks`}
            >
              {syncingAll
                ? `Syncing ${syncAllProgress.current} / ${syncAllProgress.total}…`
                : `Sync all (${filtered.length})`}
            </button>
          </div>
          {listLoading && <p className="muted" style={{ marginBottom: 8 }}>Loading equity list…</p>}
          {error && <p className="bot-live-error" style={{ marginBottom: 8 }}>{error}</p>}
          {lastResult && (
            <div style={{ padding: 10, background: '#1a1d21', borderRadius: 8, fontSize: '0.9rem', marginBottom: 12 }}>
              <p style={{ margin: '0 0 6px', fontWeight: 600 }}>
                Last sync: {lastResult.tradingsymbol ?? lastResult.name ?? '—'}
              </p>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>Day candles: {lastResult.candlesDay ?? 0}</li>
                <li>60m candles: {lastResult.candles60m ?? 0}</li>
              </ul>
            </div>
          )}
          <div
            style={{
              border: '1px solid #38444d',
              borderRadius: 8,
              maxHeight: 360,
              overflow: 'auto',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid #38444d', width: 48 }}>#</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #38444d' }}>Symbol</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid #38444d', width: 100 }}>Instrument code</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #38444d' }}>Name</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid #38444d' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inst, index) => {
                  const token = String(inst.instrument_token ?? '');
                  const isSyncing = syncingToken === token;
                  return (
                    <tr
                      key={token}
                      style={{
                        background: isSyncing ? 'rgba(29, 155, 240, 0.1)' : undefined,
                      }}
                    >
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid #2f3336', textAlign: 'right', color: '#8b98a5' }}>
                        {index + 1}
                      </td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid #2f3336' }}>
                        {inst.tradingsymbol ?? '—'}
                      </td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid #2f3336', textAlign: 'right', color: '#8b98a5', fontVariantNumeric: 'tabular-nums' }}>
                        {inst.instrument_token ?? '—'}
                      </td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid #2f3336', color: '#8b98a5' }}>
                        {inst.name ?? '—'}
                      </td>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid #2f3336', textAlign: 'right' }}>
                        <button
                          type="button"
                          className="bot-live-button"
                          style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                          onClick={() => handleSyncOne(inst)}
                          disabled={isSyncing || listLoading || syncingAll}
                        >
                          {isSyncing ? 'Syncing…' : 'Sync'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8 }}>
            {filtered.length} of {instruments.length} NSE equity stocks. Click Sync to fetch 5 years 1D + 1H for that stock.
          </p>
        </>
      )}
    </div>
  );
}
