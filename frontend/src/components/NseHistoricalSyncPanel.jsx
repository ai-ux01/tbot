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
  const [startSerial, setStartSerial] = useState(1);

  const SYNC_RANGE_COUNT = 150;
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

  const handleSync150FromSerial = async () => {
    if (!hasSession || filtered.length === 0) return;
    const serial = Math.max(1, parseInt(startSerial, 10) || 1);
    const fromIndex = serial - 1;
    const slice = filtered.slice(fromIndex, fromIndex + SYNC_RANGE_COUNT);
    if (slice.length === 0) {
      setError(`Serial ${serial} is out of range (1–${filtered.length})`);
      return;
    }
    setError(null);
    setLastResult(null);
    setSyncingAll(true);
    setSyncAllProgress({ current: 0, total: slice.length });
    let lastSuccess = null;
    for (let i = 0; i < slice.length; i++) {
      const inst = slice[i];
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

  if (!hasSession) {
    return (
      <div className="dashboard-card">
        <h2 className="dashboard-card-title">NSE Historical Sync</h2>
        <p className="dashboard-card-subtitle">
          List NSE equity stocks and sync 5 years 1D + 1H data. Requires Kite login and MongoDB.
        </p>
        <div className="dashboard-empty">
          <p>Not connected to Kite.</p>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Go to <strong>Trading</strong> and log in with Kite first.
          </p>
        </div>
      </div>
    );
  }

  const progressPct = syncAllProgress.total > 0
    ? Math.round((syncAllProgress.current / syncAllProgress.total) * 100)
    : 0;

  return (
    <div className="nse-sync-panel">
      <div className="dashboard-card">
        <h2 className="dashboard-card-title">NSE Historical Sync</h2>
        <p className="dashboard-card-subtitle">
          List NSE equity stocks and sync 5 years 1D + 1H data when you click a stock or run batch sync.
        </p>

        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Instruments loaded</div>
            <div className="kpi-value">{listLoading ? '…' : instruments.length}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Visible (filtered)</div>
            <div className="kpi-value">{filtered.length}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Last sync</div>
            <div className="kpi-value">
              {lastResult ? (lastResult.tradingsymbol ?? lastResult.name ?? '—') : '—'}
            </div>
          </div>
          {syncingAll && (
            <div className="kpi-card">
              <div className="kpi-label">Syncing</div>
              <div className="kpi-value">
                {syncAllProgress.current} / {syncAllProgress.total}
              </div>
            </div>
          )}
        </div>

        {syncingAll && (
          <div className="dashboard-progress">
            <div
              className="dashboard-progress-fill"
              style={{ width: `${progressPct}%` }}
              role="progressbar"
              aria-valuenow={syncAllProgress.current}
              aria-valuemin={0}
              aria-valuemax={syncAllProgress.total}
            />
          </div>
        )}

        <div className="dashboard-toolbar">
          <input
            type="text"
            placeholder="Search by name, symbol or instrument code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bot-live-input"
            style={{ flex: '1', minWidth: '200px', maxWidth: '320px' }}
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

        <div className="dashboard-toolbar">
          <label htmlFor="nse-start-serial" className="muted" style={{ marginRight: 4 }}>
            Start at #
          </label>
          <input
            id="nse-start-serial"
            type="number"
            min={1}
            max={filtered.length || 1}
            placeholder="1"
            value={startSerial === 1 ? '' : startSerial}
            onChange={(e) => setStartSerial(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="bot-live-input"
            style={{ width: 72 }}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={listLoading || syncingAll || filtered.length === 0}
            onClick={handleSync150FromSerial}
            title={`Sync 150 stocks starting from serial number ${startSerial}`}
          >
            Sync 150 from #{startSerial || 1}
          </button>
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            Syncs 150 items from the given serial (1-based). Use search to narrow list first.
          </span>
        </div>

        {listLoading && <p className="muted" style={{ marginBottom: 8 }}>Loading equity list…</p>}
        {error && <p className="bot-live-error" style={{ marginBottom: 8 }}>{error}</p>}

        {lastResult && (
          <div className="dashboard-card-inner">
            <p className="kpi-label" style={{ marginBottom: 4 }}>Last sync</p>
            <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: '0.9375rem' }}>
              {lastResult.tradingsymbol ?? lastResult.name ?? '—'}
            </p>
            <ul className="muted" style={{ margin: 0, paddingLeft: 20, fontSize: '0.875rem' }}>
              <li>Day candles: {lastResult.candlesDay ?? 0}</li>
              <li>60m candles: {lastResult.candles60m ?? 0}</li>
            </ul>
          </div>
        )}
      </div>

      <div className="dashboard-card">
        <h2 className="dashboard-card-title">Instruments</h2>
        <div className="dashboard-table-wrap">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th style={{ width: 48, textAlign: 'right' }}>#</th>
                <th>Symbol</th>
                <th style={{ width: 100, textAlign: 'right' }}>Instrument code</th>
                <th>Name</th>
                <th style={{ width: 90, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inst, index) => {
                const token = String(inst.instrument_token ?? '');
                const isSyncing = syncingToken === token;
                return (
                  <tr key={token} className={isSyncing ? 'syncing' : ''}>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {index + 1}
                    </td>
                    <td>{inst.tradingsymbol ?? '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {inst.instrument_token ?? '—'}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{inst.name ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
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
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8, marginBottom: 0 }}>
          {filtered.length} of {instruments.length} NSE equity stocks. Click Sync to fetch 5 years 1D + 1H for that stock.
        </p>
      </div>
    </div>
  );
}
