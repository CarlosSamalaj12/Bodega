import { create } from 'zustand';

const STORAGE_KEY = 'theme';
const VALID = ['dark', 'light'];

function readInitial() {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (VALID.includes(saved)) return saved;
  } catch {}
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#070a12');
  }
}

export const useThemeStore = create((set, get) => ({
  theme: readInitial(),

  setTheme(theme) {
    if (!VALID.includes(theme)) return;
    set({ theme });
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
    applyTheme(theme);
  },

  toggle() {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  // Aplica el tema actual al <html>. Llamar una sola vez al arrancar.
  init() {
    applyTheme(get().theme);
  },
}));
