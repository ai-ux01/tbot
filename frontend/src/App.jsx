import { useState } from 'react';
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
import './App.css';

const TABS = [
  { id: 'trading', label: 'Trading' },
  { id: 'orders', label: 'Orders & Journal' },
  { id: 'nse-sync', label: 'NSE Sync' },
  { id: 'stored-data', label: 'Stored Data' },
  { id: 'signals', label: 'AI Signals' },
  { id: 'more', label: 'More' },
];

function AppContent() {
  const { isLoggedIn, logout } = useSession();
  const [activeTab, setActiveTab] = useState('trading');
console.log('isLoggedIn', isLoggedIn);
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
    <div className="app">
      <header className="header">
        <h1>Kotak Trading</h1>
        <button type="button" className="logout" onClick={logout}>
          Logout
        </button>
      </header>

      <nav className="app-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`app-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'trading' && (
        <div className="app-tab-panel trading-panel">
            <section className="section login-section">
      
          <KiteConnectPanel />
        </section>
          {/* <section className="section">
            <h2>Intraday bot</h2>
            <BotLivePanel />
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
          <section className="section">
            <NseHistoricalSyncPanel />
          </section>
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
          <section className="section">
            <SignalsPanel />
          </section>
        </div>
      )}

      {activeTab === 'more' && (
        <div className="app-tab-panel">
          {/* <section className="section">
            <h2>Kite Connect</h2>
            <KiteConnectPanel />
          </section> */}
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
