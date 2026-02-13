import { createContext, useContext, useState, useCallback } from 'react';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [accessToken, setAccessTokenState] = useState(() =>
    typeof window !== 'undefined' ? sessionStorage.getItem('kotak_access_token') : null
  );
  const [session, setSession] = useState(() => {
    if (typeof window === 'undefined') return null;
    const raw = sessionStorage.getItem('kotak_session');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });

  const setAccessToken = useCallback((token) => {
    setAccessTokenState(token);
    if (typeof window !== 'undefined') {
      if (token) sessionStorage.setItem('kotak_access_token', token);
      // else sessionStorage.removeItem('kotak_access_token');
    }
  }, []);

  const setSessionData = useCallback((data) => {
    setSession(data);
    if (typeof window !== 'undefined') {
      if (data) sessionStorage.setItem('kotak_session', JSON.stringify(data));
      else sessionStorage.removeItem('kotak_session');
    }
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    setAccessToken(null);
  }, [setSession, setAccessToken]);

  return (
    <SessionContext.Provider
      value={{
        accessToken,
        setAccessToken,
        session,
        setSessionData,
        logout,
        isLoggedIn: !!session?.sessionId && !!session?.baseUrl,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
