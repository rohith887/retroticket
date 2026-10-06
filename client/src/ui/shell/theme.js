import { useCallback, useSyncExternalStore } from "react";

const KEY = "ds-theme";
const LEGACY_KEY = "theme"; // key used by the old theme picker

/**
 * Themes. `id` is both the data-ds-theme value (design-system tokens) and the class on <html> that the
 * legacy pages' CSS variables (styles/globals.css) are keyed on, so the whole app switches together.
 * `swatch` = [canvas, brand] preview colours for the picker.
 */
export const THEMES = [
  { id: "light", label: "Light", dark: false, swatch: ["#f8fafc", "#047857"] },
  { id: "dark", label: "Dark", dark: true, swatch: ["#0f172a", "#10b981"] },
  { id: "solarized-light", label: "Solarized Light", dark: false, swatch: ["#fdf6e3", "#1e6faa"] },
  { id: "forest", label: "Forest", dark: false, swatch: ["#e8f5e9", "#2e7d32"] },
  { id: "material-light", label: "Material Light", dark: false, swatch: ["#f5f5f5", "#1976d2"] },
  { id: "github-light", label: "GitHub Light", dark: false, swatch: ["#f6f8fa", "#0969da"] },
];
const IDS = THEMES.map((t) => t.id);

function read() {
  try {
    const saved = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
    return IDS.includes(saved) ? saved : "light";
  } catch {
    return "light";
  }
}

function apply(theme) {
  const root = document.documentElement;
  root.dataset.dsTheme = theme;
  root.classList.remove(...IDS, "dracula");
  root.classList.add(theme);
}

/** Call once before first render so the correct tokens are active immediately (no flash). */
export function initTheme() {
  apply(read());
}

// Shared store so every component that calls useTheme() (top bar, palette, settings page) stays in sync.
let current = null;
const listeners = new Set();
const getSnapshot = () => (current ??= read());
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function setTheme(id) {
  if (!IDS.includes(id) || id === getSnapshot()) return;
  current = id;
  apply(id);
  try {
    localStorage.setItem(KEY, id);
    localStorage.setItem(LEGACY_KEY, id);
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
  listeners.forEach((fn) => fn());
}

/** Light is the default and the polished theme; the others redefine the same tokens. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot);
  const toggle = useCallback(() => setTheme(getSnapshot() === "dark" ? "light" : "dark"), []);
  return { theme, setTheme, toggle, themes: THEMES };
}
