import { useState } from 'react';
import { useSession } from '../context/SessionContext';
import {
  placeOrder,
  modifyOrder,
  cancelOrder,
  getOrderBook,
  orderHistory,
  SESSION_EXPIRED_CODE,
} from '../api/kotak';

const defaultPlaceJData = {
  am: 'NO',
  dq: '0',
  es: 'nse_cm',
  mp: '0',
  pc: 'CNC',
  pf: 'N',
  pr: '0',
  pt: 'MKT',
  qt: '1',
  rt: 'DAY',
  tp: '0',
  ts: 'ITBEES-EQ',
  tt: 'B',
};

export function OrdersExample() {
  const { session, logout } = useSession();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [jData, setJData] = useState(JSON.stringify(defaultPlaceJData, null, 2));
  const [orderNo, setOrderNo] = useState('');
  const [tab, setTab] = useState('place');

  if (!session) {
    return <p className="hint">Log in first to use orders.</p>;
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

  const handlePlace = (e) => {
    e.preventDefault();
    let parsed;
    try {
      parsed = JSON.parse(jData);
    } catch {
      setError('Invalid JSON in jData');
      return;
    }
    run(() => placeOrder(session, parsed));
  };

  const handleModify = (e) => {
    e.preventDefault();
    let parsed;
    try {
      parsed = JSON.parse(jData);
    } catch {
      setError('Invalid JSON in jData');
      return;
    }
    if (!orderNo.trim()) {
      setError('Enter order number (no) in jData or order no field');
      return;
    }
    parsed.no = parsed.no || orderNo.trim();
    run(() => modifyOrder(session, parsed));
  };

  const handleCancel = (e) => {
    e.preventDefault();
    const on = orderNo.trim() || (result && (result.orderNo ?? result.nOrdNo));
    if (!on) {
      setError('Enter order number to cancel');
      return;
    }
    run(() => cancelOrder(session, { on, am: 'NO' }));
  };

  const handleOrderHistory = (e) => {
    e.preventDefault();
    run(() => orderHistory(session, orderNo ? { nOrdNo: orderNo.trim() } : {}));
  };

  return (
    <div className="orders-panel">
      <div className="tabs">
        {['place', 'modify', 'cancel', 'orderBook', 'orderHistory'].map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t === 'place' && 'Place'}
            {t === 'modify' && 'Modify'}
            {t === 'cancel' && 'Cancel'}
            {t === 'orderBook' && 'Order book'}
            {t === 'orderHistory' && 'Order history'}
          </button>
        ))}
      </div>

      {tab === 'place' && (
        <form onSubmit={handlePlace}>
          <label>jData (place order)</label>
          <textarea
            value={jData}
            onChange={(e) => setJData(e.target.value)}
            rows={14}
            spellCheck={false}
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Placing…' : 'Place order'}
          </button>
        </form>
      )}

      {tab === 'modify' && (
        <form onSubmit={handleModify}>
          <input
            type="text"
            placeholder="Order no (no)"
            value={orderNo}
            onChange={(e) => setOrderNo(e.target.value)}
          />
          <label>jData (modify payload)</label>
          <textarea
            value={jData}
            onChange={(e) => setJData(e.target.value)}
            rows={12}
            spellCheck={false}
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Modifying…' : 'Modify order'}
          </button>
        </form>
      )}

      {tab === 'cancel' && (
        <form onSubmit={handleCancel}>
          <input
            type="text"
            placeholder="Order no to cancel"
            value={orderNo}
            onChange={(e) => setOrderNo(e.target.value)}
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Cancelling…' : 'Cancel order'}
          </button>
        </form>
      )}

      {tab === 'orderBook' && (
        <div>
          <button type="button" onClick={() => run(() => getOrderBook(session))} disabled={loading}>
            {loading ? 'Loading…' : 'Fetch order book'}
          </button>
        </div>
      )}

      {tab === 'orderHistory' && (
        <form onSubmit={handleOrderHistory}>
          <input
            type="text"
            placeholder="nOrdNo (optional)"
            value={orderNo}
            onChange={(e) => setOrderNo(e.target.value)}
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Loading…' : 'Fetch order history'}
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}
      {result && (
        <pre className="result">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}
