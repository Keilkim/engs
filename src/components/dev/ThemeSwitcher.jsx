import { useState } from 'react';
import { getTheme, setTheme, ACCENTS, ACCENT_META } from '../../services/theme';

/*
 * DEV-only floating theme preview (bottom-right). Cycles the accent using the
 * same services/theme.js store as the real Settings UI, so both stay in sync
 * and it works on any screen — including the login page before auth.
 * The lock button toggles a dev auth bypass so the whole app can be previewed
 * without a real Supabase session. Mounted only when import.meta.env.DEV.
 * Remove this (and the App.jsx mount) once the theme feature is finalized.
 */

const BYPASS_KEY = 'devBypassAuth';

export default function ThemeSwitcher() {
  const [theme, setThemeState] = useState(getTheme());
  const [bypass, setBypass] = useState(() => {
    try {
      return localStorage.getItem(BYPASS_KEY) === '1';
    } catch {
      return false;
    }
  });

  const cycleAccent = () => {
    const i = ACCENTS.indexOf(theme.accent);
    setThemeState(setTheme({ accent: ACCENTS[(i + 1) % ACCENTS.length] }));
  };

  const toggleBypass = () => {
    const next = !bypass;
    try {
      localStorage.setItem(BYPASS_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
    setBypass(next);
    window.location.reload();
  };

  const pill = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderRadius: '9999px',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    background: 'rgba(20, 20, 22, 0.88)',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    fontFamily: 'system-ui, sans-serif',
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.45)',
    WebkitBackdropFilter: 'blur(8px)',
    backdropFilter: 'blur(8px)',
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '84px',
        right: '16px',
        zIndex: 99999,
        display: 'flex',
        gap: '8px',
      }}
    >
      <button type="button" onClick={cycleAccent} title="Cycle accent (dev)" style={pill}>
        <span
          style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: ACCENT_META[theme.accent].swatch,
            boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.25)',
          }}
        />
        {ACCENT_META[theme.accent].label}
      </button>
      <button
        type="button"
        onClick={toggleBypass}
        title={bypass ? 'Auth bypassed — click to require login' : 'Bypass login (dev preview)'}
        style={{ ...pill, padding: '8px 10px' }}
      >
        {bypass ? '🔓' : '🔒'}
      </button>
    </div>
  );
}
