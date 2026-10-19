import { createContext, Fragment, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

const AuthContext = createContext({});

// This hook only reads the stable module context; it does not hold refresh state.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let authEvents = 0;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        authEvents += 1;
        if (active) setUser(session?.user ?? null);
      }
    );
    const initialVersion = authEvents;
    // 현재 세션 확인 — 실패(예: env 미설정)해도 로딩이 멈추지 않도록 catch/finally
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (active && authEvents === initialVersion) setUser(session?.user ?? null);
      })
      .catch(() => {
        if (active && authEvents === initialVersion) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
  };

  return (
    <AuthContext.Provider value={value}>
      {loading ? <div className="loading-screen">Loading...</div> : (
        <Fragment key={user?.id ?? 'signed-out'}>{children}</Fragment>
      )}
    </AuthContext.Provider>
  );
}
