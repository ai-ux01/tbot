import { useState, useEffect } from 'react';
import { SessionProvider, useSession } from './context/SessionContext';
import { KotakWSProvider } from './context/KotakWSContext';
import { BotLiveProvider } from './context/BotLiveContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginFlow } from './components/LoginFlow';
import { OrdersExample } from './components/OrdersExample';
import { ReportsExample } from './components/ReportsExample';
import { QuotesExample } from './components/QuotesExample';
import { BotLivePanel } from './components/BotLivePanel';
import { SwingPanel } from './components/SwingPanel';
import { TradeJournal } from './components/TradeJournal';
import { KiteConnectPanel } from './components/KiteConnectPanel';
import { NseHistoricalSyncPanel } from './components/NseHistoricalSyncPanel';
import { StoredDataPanel } from './components/StoredDataPanel';
import { SignalsPanel } from './components/SignalsPanel';
import { getKiteProfile, getKiteLoginUrl, getStoredKiteSessionId, kiteLogout } from './api/kite';
import './App.css';

const TABS = [
  { id: 'trading', label: 'Trading' },
  { id: 'orders', label: 'Orders & Journal' },
  { id: 'nse-sync', label: 'NSE Sync' },
  { id: 'stored-data', label: 'Stored Data' },
  { id: 'signals', label: 'AI Signals' },
  { id: 'more', label: 'More' },
];

const PAGE_TITLES = {
  trading: 'Trading',
  orders: 'Orders & Journal',
  'nse-sync': 'NSE Sync',
  'stored-data': 'Stored Data',
  signals: 'AI Signals',
  more: 'More',
};

function AppContent() {
  const { isLoggedIn, logout } = useSession();
  const [activeTab, setActiveTab] = useState('trading');
  const [kiteUserName, setKiteUserName] = useState(null);
  const [kiteLoggingOut, setKiteLoggingOut] = useState(false);
  const [kiteLoggingIn, setKiteLoggingIn] = useState(false);

  const handleKiteAction = async () => {
    if (kiteUserName) {
      setKiteLoggingOut(true);
      try {
        await kiteLogout();
        setKiteUserName(null);
      } catch {
        // Keep name on error; session may still be valid
      } finally {
        setKiteLoggingOut(false);
      }
    } else {
      setKiteLoggingIn(true);
      try {
        const { loginUrl } = await getKiteLoginUrl();
        window.location.href = loginUrl;
      } catch {
        setKiteLoggingIn(false);
      }
    }
  };

  useEffect(() => {
    if (!isLoggedIn) {
      setKiteUserName(null);
      return;
    }
    const sid = getStoredKiteSessionId();
    if (!sid) {
      setKiteUserName(null);
      return;
    }
    getKiteProfile(sid)
      .then((data) => {
        const p = data?.data ?? data;
        setKiteUserName(p?.user_name ?? p?.user_id ?? null);
      })
      .catch(() => setKiteUserName(null));
  }, [isLoggedIn, activeTab]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const onKiteProfile = (e) => setKiteUserName(e.detail?.userName ?? null);
    window.addEventListener('kite-connect-profile', onKiteProfile);
    return () => window.removeEventListener('kite-connect-profile', onKiteProfile);
  }, [isLoggedIn]);

  if (!isLoggedIn) {
    return (
      <div className="app">
        <header className="header">
          <h1>Kotak Trading</h1>
        </header>
        <section className="section login-section">
          <h2>Login</h2>
          <LoginFlow />
        </section>
      </div>
    );
  }

  return (
    <div className="dashboard-wrap">
      <aside className="dashboard-sidebar">
        <div className="dashboard-sidebar-brand">
          <h2 className="brand-name">Kotak Trading</h2>
          <p className="brand-tagline">Trading dashboard</p>
        </div>
        <nav role="navigation" aria-label="Main">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="dashboard-main">
        <header className="dashboard-topbar">
          <h1>{PAGE_TITLES[activeTab] ?? 'Dashboard'}</h1>
          <div className="dashboard-topbar-actions">
            {kiteUserName && (
              <span className="dashboard-topbar-user" title="Kite user">
                {kiteUserName}
              </span>
            )}
            <button
              type="button"
              className="btn-secondary dashboard-topbar-btn"
              onClick={handleKiteAction}
              disabled={kiteLoggingOut || kiteLoggingIn}
            >
              {kiteUserName
                ? (kiteLoggingOut ? 'Logging out…' : 'Logout Kite')
                : (kiteLoggingIn ? 'Redirecting…' : 'Login with Kite')}
            </button>
            <button type="button" className="logout" onClick={logout}>
              Logout
            </button>
          </div>
        </header>
        <div className="dashboard-content">
          <div className="dashboard-page">
            {activeTab === 'trading' && (
              <div className="app-tab-panel trading-panel">
                {/* <section className="section login-section">
                  <KiteConnectPanel />
                </section> */}
                <section className="section">
                  <h2>Swing bot</h2>
                  <SwingPanel />
                </section>
              </div>
            )}

            {activeTab === 'orders' && (
              <div className="app-tab-panel">
                <section className="section">
                  <h2>Orders</h2>
                  <OrdersExample />
                </section>
                <section className="section">
                  <h2>Trade Journal</h2>
                  <TradeJournal />
                </section>
              </div>
            )}

            {activeTab === 'nse-sync' && (
              <div className="app-tab-panel">
                <NseHistoricalSyncPanel />
              </div>
            )}

            {activeTab === 'stored-data' && (
              <div className="app-tab-panel">
                <section className="section">
                  <StoredDataPanel />
                </section>
              </div>
            )}

            {activeTab === 'signals' && (
              <div className="app-tab-panel">
                <SignalsPanel />
              </div>
            )}

            {activeTab === 'more' && (
              <div className="app-tab-panel">
                <section className="section">
                  <h2>Reports</h2>
                  <ReportsExample />
                </section>
                <section className="section">
                  <h2>Quotes & Scripmaster</h2>
                  <QuotesExample />
                </section>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary showReset>
      <SessionProvider>
        <KotakWSProvider>
          <BotLiveProvider>
            <AppContent />
          </BotLiveProvider>
        </KotakWSProvider>
      </SessionProvider>
    </ErrorBoundary>
  );
}
