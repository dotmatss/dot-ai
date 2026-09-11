"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createStore, useStore, type StoreApi } from "zustand";

export const SIDEBAR_COOKIE = "dot_sidebar_collapsed";

export interface UiPreferencesState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setMobileNavOpen: (open: boolean) => void;
}

function persistSidebar(collapsed: boolean) {
  if (typeof document === "undefined") return;
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function createUiPreferencesStore(initial: { sidebarCollapsed: boolean }) {
  return createStore<UiPreferencesState>((set, get) => ({
    sidebarCollapsed: initial.sidebarCollapsed,
    mobileNavOpen: false,
    setSidebarCollapsed: (collapsed) => {
      persistSidebar(collapsed);
      set({ sidebarCollapsed: collapsed });
    },
    toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),
    setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  }));
}

const UiPreferencesContext = createContext<StoreApi<UiPreferencesState> | null>(null);

/**
 * Per-request store so server-rendered markup (sidebar width) matches the
 * client on first paint. The initial value is read from a cookie on the server.
 */
export function UiPreferencesProvider({
  children,
  initialSidebarCollapsed,
}: {
  children: ReactNode;
  initialSidebarCollapsed: boolean;
}) {
  const [store] = useState(() => createUiPreferencesStore({ sidebarCollapsed: initialSidebarCollapsed }));
  return <UiPreferencesContext.Provider value={store}>{children}</UiPreferencesContext.Provider>;
}

export function useUiPreferences<T>(selector: (state: UiPreferencesState) => T): T {
  const store = useContext(UiPreferencesContext);
  if (!store) {
    throw new Error("useUiPreferences must be used within UiPreferencesProvider");
  }
  return useStore(store, selector);
}
