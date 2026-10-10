/* Theme: 'dark' (default, like the homepage), 'light', or 'system'. */
import { bus, state } from './store.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');

export function resolvedTheme() {
  const pref = state.settings?.theme || 'dark';
  if (pref === 'system') return media.matches ? 'dark' : 'light';
  return pref === 'light' ? 'light' : 'dark';
}

export function applyTheme() {
  const theme = resolvedTheme();
  const root = document.documentElement;
  if (root.dataset.theme !== theme) {
    root.dataset.theme = theme;
    bus.emit('theme', theme);
  }
  const dark = theme === 'dark';
  window.vla.app.titlebar({ color: dark ? '#1f1f1e' : '#efebe3', symbolColor: dark ? '#e8e8e8' : '#2a2722', height: 48 });
}

media.addEventListener('change', () => { if (state.settings?.theme === 'system') applyTheme(); });
bus.on('settings', applyTheme);
