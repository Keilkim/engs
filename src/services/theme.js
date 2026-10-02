/*
 * Theme system — two axes:
 *   mode:   dark | light        (neutrals: bg / text / borders / glass / shadow)
 *   accent: orange | blue | indigo | royal | violet
 *
 * Applied as data-mode / data-accent on <html>; the CSS lives in
 * styles/base/themes.css (accents and light mode) + variables.css (dark base).
 * Persisted to localStorage and kept independent
 * of Supabase so it works before login and never blocks on the network.
 */

export const MODES = ['light', 'dark'];
export const ACCENTS = ['orange', 'blue', 'indigo', 'royal', 'violet'];

export const ACCENT_META = {
  orange: { label: 'Orange Dust', swatch: '#F47716', ref: 'Signature' },
  blue: { label: 'Blue', swatch: '#0A84FF', ref: 'iOS' },
  indigo: { label: 'Indigo', swatch: '#5B63D3', ref: 'Linear / Stripe' },
  royal: { label: 'Royal', swatch: '#2563EB', ref: 'Tailwind / Vercel' },
  violet: { label: 'Violet', swatch: '#7C5CFF', ref: 'Modern' },
};

export const MODE_ENABLED = { dark: true, light: true };

const MODE_KEY = 'themeMode';
const ACCENT_KEY = 'themeAccent';
const DEFAULTS = { mode: 'light', accent: 'orange' };

export function getTheme() {
  let { mode, accent } = DEFAULTS;
  try {
    const m = localStorage.getItem(MODE_KEY);
    const a = localStorage.getItem(ACCENT_KEY);
    if (MODES.includes(m) && MODE_ENABLED[m]) mode = m;
    if (ACCENTS.includes(a)) accent = a;
  } catch {
    /* ignore — fall back to defaults */
  }
  return { mode, accent };
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme.mode) root.dataset.mode = theme.mode;
  if (theme.accent) root.dataset.accent = theme.accent;
}

export function setTheme(patch) {
  const next = { ...getTheme(), ...patch };
  try {
    localStorage.setItem(MODE_KEY, next.mode);
    localStorage.setItem(ACCENT_KEY, next.accent);
  } catch {
    /* ignore — still apply in-memory */
  }
  applyTheme(next);
  return next;
}

// Call once at boot, before React renders, to avoid a flash of the default theme.
export function initTheme() {
  applyTheme(getTheme());
}
