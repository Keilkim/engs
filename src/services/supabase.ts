import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Auto-login-aware storage adapter.
 *
 * The login screen writes a `autoLogin` flag ('true' | 'false') to localStorage
 * before signing in. When the user explicitly unchecks "자동 로그인"
 * (autoLogin === 'false'), the auth session is persisted to sessionStorage so it
 * is cleared when the browser is closed — protecting accounts on shared devices.
 * Otherwise (default) the session persists in localStorage as before.
 *
 * Reads check sessionStorage first so a session written during a "no auto-login"
 * run is still found within the same tab.
 */
const autoLoginStorage = {
  getItem: (key: string): string | null => {
    try {
      return sessionStorage.getItem(key) ?? localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      const persist = localStorage.getItem('autoLogin') !== 'false';
      if (persist) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    } catch {
      // storage unavailable (private mode) — ignore
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: autoLoginStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
