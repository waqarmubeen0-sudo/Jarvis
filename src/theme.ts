// Theme switcher (Settings → Theme): sets <html data-theme>, which swaps the CSS variables in
// themes.css, and remembers the choice in this browser.
export const THEMES = [
  { id: 'jarvis', name: 'J.A.R.V.I.S.', desc: 'Default glassmorphism, cyan HUD' },
  { id: 'cyberpunk', name: 'Cyberpunk', desc: 'Brutalist black, neon red, CRT scanlines' },
  { id: 'stealth', name: 'Stealth', desc: 'Minimal dark slate, purple, no glow' },
  { id: 'terminal', name: 'Terminal', desc: 'Retro pitch black, amber monospace' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];

const KEY = 'jv-theme';
const valid = (t: unknown): t is ThemeId => THEMES.some((x) => x.id === t);

export function loadTheme(): ThemeId {
  try { const t = localStorage.getItem(KEY); return valid(t) ? t : 'jarvis'; } catch { return 'jarvis'; }
}

export function applyTheme(t: ThemeId) {
  if (t === 'jarvis') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* private mode: still applied for this visit */ }
}

applyTheme(loadTheme()); // before first paint, so there is no flash of the default theme
