import { useState, useEffect, useCallback } from 'react';
import { syncNseHistorical, getKiteInstruments, getStoredKiteSessionId, filterNseDisplayInstruments } from '../api/kite';

const EQ = 'EQ';
const NSE_SYNC_COMPLETED_KEY = 'nse_sync_completed_tokens';
const NSE_SYNC_STATUS_KEY = 'nse_sync_status';

function getSyncedTokens() {
  try {
    if (typeof window === 'undefined') return new Set();
    const raw = localStorage.getItem(NSE_SYNC_COMPLETED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function getNseSyncStatus() {
  try {
    if (typeof window === 'undefined') return { running: false, current: 0, total: 0 };
    const raw = localStorage.getItem(NSE_SYNC_STATUS_KEY);
    const o = raw ? JSON.parse(raw) : {};
    return {
      running: !!o.running,
      current: Number(o.current) || 0,
      total: Number(o.total) || 0,
    };
  } catch {
    return { running: false, current: 0, total: 0 };
  }
}

function setNseSyncStatus(status) {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(NSE_SYNC_STATUS_KEY, JSON.stringify(status));
    }
  } catch (_) {}
}

function addSyncedToken(token) {
  if (!token) return;
  const set = getSyncedTokens();
  set.add(String(token));
  try {
    localStorage.setItem(NSE_SYNC_COMPLETED_KEY, JSON.stringify([...set]));
  } catch (_) {}
}

function clearSyncedProgress() {
  try {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(NSE_SYNC_COMPLETED_KEY);
      localStorage.removeItem(NSE_SYNC_STATUS_KEY);
    }
  } catch (_) {}
}

function useKiteSession() {
  const [hasSession, setHasSession] = useState(() => !!getStoredKiteSessionId());

  const recheck = useCallback(() => {
    setHasSession(!!getStoredKiteSessionId());
  }, []);

  useEffect(() => {
    const onProfile = () => setHasSession(!!getStoredKiteSessionId());
    window.addEventListener('kite-connect-profile', onProfile);
    return () => window.removeEventListener('kite-connect-profile', onProfile);
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') setHasSession(!!getStoredKiteSessionId());
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return [hasSession, recheck];
}

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
  const [syncProgressVersion, setSyncProgressVersion] = useState(0);
  const [hasSession, recheckSession] = useKiteSession();

  const SYNC_RANGE_COUNT = 150;

  useEffect(() => {
    const status = getNseSyncStatus();
    if (status.running && status.total > 0) {
      setSyncingAll(true);
      setSyncAllProgress({ current: status.current, total: status.total });
    }
  }, []);

  useEffect(() => {
    if (!syncingAll) return;
    const id = setInterval(() => {
      const status = getNseSyncStatus();
      setSyncAllProgress((p) => ({ ...p, current: status.current, total: status.total }));
      if (!status.running) setSyncingAll(false);
    }, 1500);
    return () => clearInterval(id);
  }, [syncingAll]);

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
      addSyncedToken(token);
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
    const syncedSet = getSyncedTokens();
    const toSync = filtered.filter((inst) => !syncedSet.has(String(inst.instrument_token ?? '')));
    if (toSync.length === 0) {
      setError('All visible instruments already synced. Use "Clear progress" to resync from start.');
      return;
    }
    setError(null);
    setLastResult(null);
    setSyncingAll(true);
    setSyncAllProgress({ current: 0, total: toSync.length });
    setNseSyncStatus({ running: true, current: 0, total: toSync.length });
    let lastSuccess = null;
    for (let i = 0; i < toSync.length; i++) {
      const inst = toSync[i];
      const token = String(inst.instrument_token ?? '');
      if (!token) continue;
      setSyncingToken(token);
      setSyncAllProgress((p) => ({ ...p, current: i + 1 }));
      setNseSyncStatus({ running: true, current: i + 1, total: toSync.length });
      try {
        const data = await syncNseHistorical({ instrument_token: token });
        addSyncedToken(token);
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
    setNseSyncStatus({ running: false, current: 0, total: 0 });
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
    const syncedSet = getSyncedTokens();
    const toSync = slice.filter((inst) => !syncedSet.has(String(inst.instrument_token ?? '')));
    if (toSync.length === 0) {
      setError('All 150 instruments already synced. Use "Clear progress" to resync.');
      return;
    }
    setError(null);
    setLastResult(null);
    setSyncingAll(true);
    setSyncAllProgress({ current: 0, total: toSync.length });
    setNseSyncStatus({ running: true, current: 0, total: toSync.length });
    let lastSuccess = null;
    for (let i = 0; i < toSync.length; i++) {
      const inst = toSync[i];
      const token = String(inst.instrument_token ?? '');
      if (!token) continue;
      setSyncingToken(token);
      setSyncAllProgress((p) => ({ ...p, current: i + 1 }));
      setNseSyncStatus({ running: true, current: i + 1, total: toSync.length });
      try {
        const data = await syncNseHistorical({ instrument_token: token });
        addSyncedToken(token);
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
    setNseSyncStatus({ running: false, current: 0, total: 0 });
    if (lastSuccess) setLastResult(lastSuccess);
  };

  const handleClearProgress = () => {
    clearSyncedProgress();
    setSyncingAll(false);
    setSyncAllProgress({ current: 0, total: 0 });
    setSyncingToken(null);
    setSyncProgressVersion((v) => v + 1);
    setError(null);
  };

  const syncedSet = getSyncedTokens();
  const toSyncCount = filtered.filter((inst) => !syncedSet.has(String(inst.instrument_token ?? ''))).length;
  const alreadySyncedCount = filtered.length - toSyncCount;

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
            Use <strong>Login with Kite</strong> in the header, or go to <strong>More</strong> → Kite Connect to log in.
          </p>
          <button type="button" className="btn-secondary" onClick={recheckSession} style={{ marginTop: 8 }}>
            Recheck connection
          </button>
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
          List NSE equity stocks and sync 5 years 1D + 1H data when you click a stock or run batch sync. Sync continues in the background if you leave this page.
          For a complete same-day daily bar, run after NSE close (~3:30 PM IST). Server uses IST calendar for incremental ranges.
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
            <div className="kpi-label">Already synced / remaining</div>
            <div className="kpi-value">{alreadySyncedCount} / {toSyncCount}</div>
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
            disabled={listLoading || syncingAll || filtered.length === 0 || toSyncCount === 0}
            onClick={handleSyncAll}
            title={toSyncCount > 0 ? `Sync ${toSyncCount} remaining (${alreadySyncedCount} already done)` : 'All synced'}
          >
            {syncingAll
              ? `Syncing ${syncAllProgress.current} / ${syncAllProgress.total}…`
              : toSyncCount > 0
                ? `Sync all (${toSyncCount} remaining)`
                : 'Sync all (all synced)'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={listLoading}
            onClick={handleClearProgress}
            title="Clear stored sync progress (completed tokens + batch status). Use when filters hide synced rows, or sync looks stuck."
          >
            Clear progress
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
              {lastResult.durationMs != null && Number.isFinite(lastResult.durationMs) && (
                <li>
                  Duration:{' '}
                  {lastResult.durationMs < 1000
                    ? `${Math.round(lastResult.durationMs)} ms`
                    : `${(lastResult.durationMs / 1000).toFixed(1)} s`}
                </li>
              )}
              {lastResult.completedAt && (
                <li>
                  Finished (IST):{' '}
                  {new Date(lastResult.completedAt).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    dateStyle: 'medium',
                    timeStyle: 'medium',
                  })}
                </li>
              )}
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
