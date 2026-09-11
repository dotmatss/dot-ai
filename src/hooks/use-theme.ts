"use client";

import { useSyncExternalStore } from "react";

import {
  DEFAULT_THEME,
  THEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  applyTheme,
  parseTheme,
  resolveTheme,
  type ResolvedTheme,
  type Theme,
} from "@/lib/theme/theme";

export interface ThemeState {
  /** What the visitor chose, including "system". */
  theme: Theme;
  /** What is actually painted. Null on the server, where it is unknowable. */
  resolvedTheme: ResolvedTheme | null;
}

/**
 * Application-wide theme state.
 *
 * A module-level external store rather than a React context, for two reasons.
 * The preference lives in `localStorage`, which is already a browser-global
 * singleton, so wrapping it in a provider would add a tree without adding an
 * owner. And `useSyncExternalStore` is what lets the server render one value
 * and the client adopt another without a hydration mismatch and without
 * calling setState from an effect.
 *
 * Every DOM write happens here, in the store, never in a component effect.
 */

const listeners = new Set<() => void>();

/** Frozen server value: identical for every request, so nothing leaks. */
const SERVER_STATE: ThemeState = { theme: DEFAULT_THEME, resolvedTheme: null };

/**
 * `getSnapshot` must return a stable reference while nothing has changed, or
 * React re-renders forever. So the computed state is cached and only replaced
 * when a field actually differs.
 */
let cache: ThemeState = SERVER_STATE;

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(THEME_MEDIA_QUERY).matches;
}

function readStoredTheme(): Theme {
  try {
    return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Private mode, or a browser configured to block site data. The theme
    // still works for this page; it just will not be remembered.
    return DEFAULT_THEME;
  }
}

function getSnapshot(): ThemeState {
  const theme = readStoredTheme();
  const resolvedTheme = resolveTheme(theme, systemPrefersDark());
  if (cache.theme === theme && cache.resolvedTheme === resolvedTheme) return cache;
  cache = { theme, resolvedTheme };
  return cache;
}

function getServerSnapshot(): ThemeState {
  return SERVER_STATE;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);

  const media = typeof window.matchMedia === "function" ? window.matchMedia(THEME_MEDIA_QUERY) : null;

  // Follow the operating system, but only while "system" is the choice.
  const onMediaChange = () => {
    if (readStoredTheme() === "system") {
      applyTheme(document.documentElement, systemPrefersDark() ? "dark" : "light");
    }
    notify();
  };
  // Another tab changed the preference; keep this one in step.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    const theme = readStoredTheme();
    applyTheme(document.documentElement, resolveTheme(theme, systemPrefersDark()));
    notify();
  };

  media?.addEventListener("change", onMediaChange);
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(onStoreChange);
    media?.removeEventListener("change", onMediaChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function setTheme(next: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Not remembered, but still applied below.
  }
  applyTheme(document.documentElement, resolveTheme(next, systemPrefersDark()));
  notify();
}

export function useTheme(): ThemeState & { setTheme: (theme: Theme) => void } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...state, setTheme };
}

/** Resets the module cache. Test-only; production never needs it. */
export function __resetThemeCache(): void {
  cache = SERVER_STATE;
}
