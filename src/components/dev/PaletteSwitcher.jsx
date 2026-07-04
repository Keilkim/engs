import { useEffect, useState } from 'react';

/*
 * TEMPORARY dev-only palette explorer.
 * Cycles document.documentElement.dataset.palette across the candidates in
 * styles/base/candidates.css so the whole app re-skins live. Persists the pick
 * to localStorage. Mounted only when import.meta.env.DEV in App.jsx.
 * Remove this file (and its mount + candidates.css) once a palette is chosen.
 */

const PALETTES = ['default', 'azure', 'royal', 'indigo', 'github'];
const SWATCH = {
  default: '#0A84FF', // iOS (current)
  azure: '#2589D6', // Telegram / X
  royal: '#2563EB', // Tailwind / Vercel
  indigo: '#5B63D3', // Linear / Stripe
  github: '#2F81F7', // GitHub dark
};
const STORAGE_KEY = 'devPalette';

function applyPalette(name) {
  const root = document.documentElement;
  if (name === 'default') {
    delete root.dataset.palette;
  } else {
    root.dataset.palette = name;
  }
}

export default function PaletteSwitcher() {
  const [palette, setPalette] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'default';
    } catch {
      return 'default';
    }
  });

  useEffect(() => {
    applyPalette(palette);
    try {
      localStorage.setItem(STORAGE_KEY, palette);
    } catch {
      /* ignore */
    }
  }, [palette]);

  const cycle = () => {
    const i = PALETTES.indexOf(palette);
    setPalette(PALETTES[(i + 1) % PALETTES.length]);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      title="Cycle theme palette (dev only)"
      style={{
        position: 'fixed',
        bottom: '84px',
        right: '16px',
        zIndex: 99999,
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
        letterSpacing: '0.02em',
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.45)',
        WebkitBackdropFilter: 'blur(8px)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <span
        style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          background: SWATCH[palette],
          boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.25)',
        }}
      />
      {palette}
    </button>
  );
}
