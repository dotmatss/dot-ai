"use client";

import type { ReactNode } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { cn } from "@/lib/cn";
import { UiPreferencesProvider, useUiPreferences } from "@/stores/ui-preferences-store";

function ShellFrame({ children }: { children: ReactNode }) {
  const collapsed = useUiPreferences((s) => s.sidebarCollapsed);
  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar />
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-[padding] duration-200 ease-out-soft",
          collapsed ? "lg:pl-sidebar-collapsed" : "lg:pl-sidebar",
        )}
      >
        <Topbar />
        <main id="main" className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Authenticated application frame. Page content (Server Components) is passed
 * as children so only the interactive chrome ships to the client.
 */
export function AppShell({ children, initialSidebarCollapsed }: { children: ReactNode; initialSidebarCollapsed: boolean }) {
  return (
    <UiPreferencesProvider initialSidebarCollapsed={initialSidebarCollapsed}>
      <ShellFrame>{children}</ShellFrame>
    </UiPreferencesProvider>
  );
}
