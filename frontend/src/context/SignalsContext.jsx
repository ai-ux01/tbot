import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { getSignalsCombined, evaluateSignal, evaluateAllSignals } from '../api/signals';

const POLL_INTERVAL_MS = 30000;

const SignalsContext = createContext(null);

export function SignalsProvider({ children, activeTab }) {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [signalTypeFilter, setSignalTypeFilter] = useState('BUY');
  const [evaluating, setEvaluating] = useState(null);
  const [evalForm, setEvalForm] = useState({ instrument: '', timeframe: 'day' });
  const [evaluateAllRunning, setEvaluateAllRunning] = useState(false);
  const [evaluateAllResult, setEvaluateAllResult] = useState(null);

  const fetchSignals = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await getSignalsCombined({ limit: 200 });
      setSignals(Array.isArray(data.signals) ? data.signals : []);
    } catch (e) {
      setError(e?.message ?? 'Failed to load signals');
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'signals') return;
    fetchSignals();
    const id = setInterval(fetchSignals, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [activeTab, fetchSignals]);

  const handleEvaluate = useCallback(async () => {
    const inst = (evalForm.instrument || '').trim();
    const tf = (evalForm.timeframe || 'day').trim();
    if (!inst) {
      setError('Enter instrument/symbol');
      return;
    }
    setError(null);
    setEvaluating(inst);
    try {
      await evaluateSignal({ instrument: inst, tradingsymbol: inst, timeframe: tf });
      await fetchSignals();
    } catch (e) {
      setError(e?.message ?? 'Evaluate failed');
    } finally {
      setEvaluating(null);
    }
  }, [evalForm, fetchSignals]);

  const handleEvaluateAll = useCallback(async () => {
    setError(null);
    setEvaluateAllResult(null);
    setEvaluateAllRunning(true);
    try {
      const data = await evaluateAllSignals();
      setEvaluateAllResult(data);
      await fetchSignals();
    } catch (e) {
      setError(e?.message ?? 'Run analysis on all failed');
    } finally {
      setEvaluateAllRunning(false);
    }
  }, [fetchSignals]);

  const filteredSignals = useMemo(() => {
    const searchLower = search.trim().toLowerCase();
    return signals.filter((s) => {
      const matchType = signalTypeFilter === 'all' || (s.signal_type || 'HOLD') === signalTypeFilter;
      const matchSearch = !searchLower || [s.instrument, s.tradingsymbol].some(
        (v) => String(v || '').toLowerCase().includes(searchLower)
      );
      return matchType && matchSearch;
    });
  }, [signals, search, signalTypeFilter]);

  const buyCount = filteredSignals.filter((s) => s.signal_type === 'BUY').length;
  const sellCount = filteredSignals.filter((s) => s.signal_type === 'SELL').length;

  const value = {
    signals,
    loading,
    error,
    setError,
    search,
    setSearch,
    signalTypeFilter,
    setSignalTypeFilter,
    evaluating,
    evalForm,
    setEvalForm,
    evaluateAllRunning,
    evaluateAllResult,
    fetchSignals,
    handleEvaluate,
    handleEvaluateAll,
    filteredSignals,
    buyCount,
    sellCount,
  };

  return (
    <SignalsContext.Provider value={value}>
      {children}
    </SignalsContext.Provider>
  );
}

export function useSignals() {
  const ctx = useContext(SignalsContext);
  return ctx;
}
