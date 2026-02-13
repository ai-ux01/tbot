import { useState } from 'react';
import { useSession } from '../context/SessionContext';
import { useKotakWS } from '../context/KotakWSContext';
import { SocketChart } from './SocketChart';

const DEFAULT_SCRIPS = 'nse_cm|11536&nse_cm|1594&nse_cm|3456';
const DEFAULT_INDEX = 'nse_cm|Nifty 50&nse_cm|Nifty Realty';
const DEFAULT_DEPTH = 'nse_cm|11536&nse_cm|11000';

export function KotakWebSocketPanel() {
  const { session, isLoggedIn } = useSession();
  const {
    status,
    logs,
    chartData,
    connect,
    disconnect,
    subscribeScrips,
    subscribeIndex,
    subscribeDepth,
    pauseChannels,
    resumeChannels,
    clearLogs,
    clearChartData,
  } = useKotakWS();

  const [channelNum, setChannelNum] = useState('1');
  const [scrips, setScrips] = useState(DEFAULT_SCRIPS);
  const [indexScrips, setIndexScrips] = useState(DEFAULT_INDEX);
  const [depthScrips, setDepthScrips] = useState(DEFAULT_DEPTH);

  const chNum = Number(channelNum) || 1;

  if (!isLoggedIn) {
    return <p className="hint">Log in to connect and subscribe to market data (HSM).</p>;
  }

  const canConnectDirect = session?.auth && session?.sid;

  return (
    <div className="ws-panel">
      {!canConnectDirect && (
        <p className="hint">Direct HSM connect is not available (Auth/Sid are server-side). Use <strong>Bot live</strong> above for market data.</p>
      )}
      <div className="ws-controls">
        <span className="ws-status" data-status={status}>
          {status}
        </span>
        <button
          type="button"
          onClick={() => connect(session)}
          disabled={status === 'connecting' || status === 'open' || !canConnectDirect}
          title={!canConnectDirect ? 'Auth/Sid not available in browser' : undefined}
        >
          Connect HSM
        </button>
        <button
          type="button"
          onClick={disconnect}
          disabled={status !== 'open' && status !== 'connecting'}
        >
          Disconnect
        </button>
        <button type="button" onClick={clearLogs} className="secondary">
          Clear log
        </button>
        <button type="button" onClick={clearChartData} className="secondary">
          Clear chart
        </button>
      </div>

      <div className="ws-chart-section">
        <SocketChart />
        {chartData.length > 0 && (
          <span className="chart-count">{chartData.length} ticks</span>
        )}
      </div>

      <div className="ws-subscribe">
        <label>Channel #</label>
        <input
          type="text"
          value={channelNum}
          onChange={(e) => setChannelNum(e.target.value)}
          placeholder="1"
        />

        <div className="ws-sub-block">
          <label>Scrips (e.g. nse_cm|11536&nse_cm|1594)</label>
          <textarea
            value={scrips}
            onChange={(e) => setScrips(e.target.value)}
            rows={2}
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => subscribeScrips(scrips, chNum)}
            disabled={status !== 'open'}
          >
            Subscribe Scrips
          </button>
        </div>

        <div className="ws-sub-block">
          <label>Indices (e.g. nse_cm|Nifty 50)</label>
          <textarea
            value={indexScrips}
            onChange={(e) => setIndexScrips(e.target.value)}
            rows={2}
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => subscribeIndex(indexScrips, chNum)}
            disabled={status !== 'open'}
          >
            Subscribe Index
          </button>
        </div>

        <div className="ws-sub-block">
          <label>Depth (MD)</label>
          <textarea
            value={depthScrips}
            onChange={(e) => setDepthScrips(e.target.value)}
            rows={2}
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => subscribeDepth(depthScrips, chNum)}
            disabled={status !== 'open'}
          >
            Subscribe Depth
          </button>
        </div>

        <div className="ws-channel-actions">
          <button
            type="button"
            onClick={() => pauseChannels(chNum)}
            disabled={status !== 'open'}
            className="danger"
          >
            Pause channel
          </button>
          <button
            type="button"
            onClick={() => resumeChannels(chNum)}
            disabled={status !== 'open'}
            className="success"
          >
            Resume channel
          </button>
        </div>
      </div>

      <div className="ws-log">
        <label>Stream log</label>
        <div className="ws-log-content">
          {logs.length === 0 ? (
            <span className="muted">Connect and subscribe to see messages.</span>
          ) : (
            logs.map(({ ts, line, isError }, i) => (
              <div key={i} className={isError ? 'log-error' : ''}>
                <span className="log-ts">[{ts}]</span> {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
