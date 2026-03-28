import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './context/SessionContext';
import { KotakWSProvider } from './context/KotakWSContext';
import { BotLiveProvider } from './context/BotLiveContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginFlow } from './components/LoginFlow';
import { OrdersExample } from './components/OrdersExample';
import { ReportsExample } from './components/ReportsExample';
import { QuotesExample } from './components/QuotesExample';
import { SwingPanel } from './components/SwingPanel';
import { TradeJournal } from './components/TradeJournal';
import { KiteConnectPanel } from './components/KiteConnectPanel';
import { NseHistoricalSyncPanel } from './components/NseHistoricalSyncPanel';
import { StoredDataPanel } from './components/StoredDataPanel';
import { SignalsPanel } from './components/SignalsPanel';
import { SignalsSidebarBlock } from './components/SignalsSidebarBlock';
import { RsiSetupPanel } from './components/RsiSetupPanel';
import { EightyPercentPanel } from './components/EightyPercentPanel';
import { RsiMaSetupCopyPanel } from './components/RsiMaSetupCopyPanel';
import { BacktestHubPanel } from './components/BacktestHubPanel';
import { PaperTradingPanel } from './components/PaperTradingPanel';
import { SignalsProvider } from './context/SignalsContext';
import { getKiteProfile, getKiteLoginUrl, getStoredKiteSessionId, setStoredKiteSessionId, kiteLogout } from './api/kite';
import './App.css';

const PATH_TITLES = {
  '/rsi-setup': 'RSI Setup',
  '/eighty-percent': 'RSI↓MA Setup',
  '/rsi-ma-setup-copy': 'RSI↓MA Setup (copy)',
  '/backtest': 'Backtest',
  '/paper-trading': 'Paper trading',
  '/trading': 'Trading',
  '/orders': 'Orders & Journal',
  '/nse-sync': 'NSE Sync',
  '/stored-data': 'Stored Data',
  '/more': 'More',
  '/signals': 'AI Signals',
};

const NAV_ITEMS = [
  { to: '/rsi-setup', label: 'RSI Setup' },
  { to: '/eighty-percent', label: 'RSI↓MA Setup' },
  { to: '/rsi-ma-setup-copy', label: 'RSI↓MA (copy)' },
  { to: '/backtest', label: 'Backtest' },
  { to: '/paper-trading', label: 'Paper trading' },
  { to: '/trading', label: 'Trading' },
  { to: '/orders', label: 'Orders & Journal' },
  { to: '/nse-sync', label: 'NSE Sync' },
  { to: '/stored-data', label: 'Stored Data' },
  { to: '/more', label: 'More' },
];

function KiteRedirectHandler() {
  useEffect(() => {
    const search = window.location.search || '';
    const hash = window.location.hash || '';
    const hashQuery = hash.includes('?') ? hash.split('?')[1] : '';
    const params = new URLSearchParams(search + (hashQuery ? `&${hashQuery}` : ''));
    const kite = params.get('kite');
    const kiteSid = params.get('kite_sid');
    if (kite !== 'success' || !kiteSid) return;
    const sid = decodeURIComponent(kiteSid);
    setStoredKiteSessionId(sid);
    window.dispatchEvent(new CustomEvent('kite-session-updated'));
    window.dispatchEvent(new CustomEvent('kite-connect-profile', { detail: {} }));
    const k = ['kite', 'kite_sid'];
    const u = new URL(window.location.href);
    k.forEach((key) => u.searchParams.delete(key));
    const hashParts = (u.hash || '#').split('?');
    const hashParams = new URLSearchParams(hashParts[1] || '');
    k.forEach((key) => hashParams.delete(key));
    const newHash = hashParts[0] + (hashParams.toString() ? `?${hashParams.toString()}` : '');
    window.history.replaceState({}, '', u.pathname + u.search + (newHash !== '#' ? newHash : ''));
  }, []);
  return null;
}

function DashboardLayout() {
  const { logout } = useSession();
  const location = useLocation();
  const [kiteUserName, setKiteUserName] = useState(null);
  const [kiteLoggingOut, setKiteLoggingOut] = useState(false);
  const [kiteLoggingIn, setKiteLoggingIn] = useState(false);
  const [kiteSessionBump, setKiteSessionBump] = useState(0);

  const pageTitle = PATH_TITLES[location.pathname] ?? 'Dashboard';

  const handleKiteAction = async () => {
    if (kiteUserName) {
      setKiteLoggingOut(true);
      try {
        await kiteLogout();
        setKiteUserName(null);
      } catch {
        // Keep name on error
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
  }, [location.pathname, kiteSessionBump]);

  useEffect(() => {
    const onKiteSessionUpdated = () => setKiteSessionBump((b) => b + 1);
    window.addEventListener('kite-session-updated', onKiteSessionUpdated);
    return () => window.removeEventListener('kite-session-updated', onKiteSessionUpdated);
  }, []);

  useEffect(() => {
    const onKiteProfile = (e) => setKiteUserName(e.detail?.userName ?? null);
    window.addEventListener('kite-connect-profile', onKiteProfile);
    return () => window.removeEventListener('kite-connect-profile', onKiteProfile);
  }, []);

  return (
    <SignalsProvider activePathname={location.pathname}>
      <div className="dashboard-wrap">
        <aside className="dashboard-sidebar">
          <div className="dashboard-sidebar-brand">
            <h2 className="brand-name">Kotak Trading</h2>
            <p className="brand-tagline">Trading dashboard</p>
          </div>
          <nav role="navigation" aria-label="Main">
            {NAV_ITEMS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          {location.pathname === '/signals' && <SignalsSidebarBlock />}
        </aside>
        <main className="dashboard-main">
          <header className="dashboard-topbar">
            <h1>{pageTitle}</h1>
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
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </SignalsProvider>
  );
}

function LoggedInApp() {
  return (
    <>
      <KiteRedirectHandler />
      <Routes>
        <Route path="/" element={<DashboardLayout />}>
          <Route index element={<Navigate to="/rsi-setup" replace />} />
          <Route path="rsi-setup" element={<RsiSetupPanel />} />
          <Route path="eighty-percent" element={<EightyPercentPanel />} />
          <Route path="rsi-ma-setup-copy" element={<RsiMaSetupCopyPanel />} />
          <Route path="backtest" element={<BacktestHubPanel />} />
          <Route path="paper-trading" element={<PaperTradingPanel />} />
          <Route
            path="trading"
            element={(
              <div className="app-tab-panel trading-panel">
                <section className="section login-section">
                  <KiteConnectPanel />
                </section>
                <section className="section">
                  <h2>Swing bot</h2>
                  <SwingPanel />
                </section>
              </div>
            )}
          />
          <Route
            path="orders"
            element={(
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
          />
          <Route path="nse-sync" element={<div className="app-tab-panel"><NseHistoricalSyncPanel /></div>} />
          <Route
            path="stored-data"
            element={(
              <div className="app-tab-panel">
                <section className="section">
                  <StoredDataPanel />
                </section>
              </div>
            )}
          />
          <Route path="signals" element={<div className="app-tab-panel"><SignalsPanel /></div>} />
          <Route
            path="more"
            element={(
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
          />
          <Route path="*" element={<Navigate to="/rsi-setup" replace />} />
        </Route>
      </Routes>
    </>
  );
}

function AppContent() {
  const { isLoggedIn } = useSession();

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
    <BrowserRouter>
      <LoggedInApp />
    </BrowserRouter>
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
