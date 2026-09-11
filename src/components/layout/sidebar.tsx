"use client";

import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { AppButton } from "@/components/ui/app-button";
import { AppTooltip } from "@/components/ui/app-tooltip";
import { isNavItemActive, workspaceNavigation, type NavItem } from "@/config/navigation";
import { WorkspaceSwitcher } from "@/features/workspaces/components/workspace-switcher";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { cn } from "@/lib/cn";
import { useUiPreferences } from "@/stores/ui-preferences-store";

function NavLink({ item, slug, pathname, collapsed, onNavigate }: { item: NavItem; slug: string; pathname: string; collapsed: boolean; onNavigate?: () => void }) {
  const href = item.href(slug);
  const active = isNavItemActive(pathname, href, item.matchPrefix ?? true);
  const Icon = item.icon;
  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-md text-sm font-medium transition-colors focus-ring",
        collapsed ? "justify-center px-0 py-2" : "px-2.5 py-2",
        active ? "bg-accent text-accent-foreground" : "text-foreground-secondary hover:bg-surface-muted hover:text-foreground",
      )}
    >
      <Icon aria-hidden className={cn("size-4 shrink-0", active ? "text-accent-foreground" : "text-foreground-muted group-hover:text-foreground")} />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <AppTooltip content={item.label} side="right">
      {link}
    </AppTooltip>
  );
}

function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;

  return (
    <nav aria-label="Workspace" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-3 scrollbar-thin">
      {workspaceNavigation.map((group) => (
        <div key={group.key} className="flex flex-col gap-0.5">
          {group.label && !collapsed ? (
            <p className="mb-1 px-2.5 text-caption font-medium uppercase tracking-[0.08em] text-foreground-subtle">{group.label}</p>
          ) : null}
          {group.label && collapsed ? <div className="mx-2 my-1 h-px bg-border" aria-hidden /> : null}
          {group.items.map((item) => (
            <NavLink key={item.key} item={item} slug={slug} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  const collapsed = useUiPreferences((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiPreferences((s) => s.toggleSidebar);
  const mobileOpen = useUiPreferences((s) => s.mobileNavOpen);
  const setMobileOpen = useUiPreferences((s) => s.setMobileNavOpen);
  const pathname = usePathname();

  // Close the mobile drawer after navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen, setMobileOpen]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-surface transition-[width] duration-200 ease-out-soft lg:flex",
          collapsed ? "w-sidebar-collapsed" : "w-sidebar",
        )}
      >
        <div className={cn("flex h-topbar items-center border-b border-border", collapsed ? "justify-center px-2" : "px-3")}>
          <WorkspaceSwitcher collapsed={collapsed} />
        </div>
        <SidebarContent collapsed={collapsed} />
        <div className={cn("border-t border-border p-3", collapsed && "flex justify-center")}>
          <AppButton
            variant="ghost"
            size={collapsed ? "icon-sm" : "sm"}
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            leadingIcon={collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
            className={cn(!collapsed && "w-full justify-start text-foreground-muted")}
          >
            {collapsed ? null : "Collapse"}
          </AppButton>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            // A scrim is a shade, not a surface, so no semantic token describes
            // it: it has to darken in BOTH themes, and every token that is dark
            // in the light theme is light in the dark one. The two values mirror
            // the `dialog::backdrop` rules in globals.css so the drawer dims the
            // page by the same amount a dialog does. `dark:` is now bound to the
            // class in globals.css, so either form would work; this one is kept
            // because it says outright which class it reads.
            className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px] in-[.dark]:bg-ink-950/70"
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface shadow-lg animate-[drawer-in_200ms_var(--ease-out-soft)]">
            <div className="flex h-topbar items-center justify-between gap-2 border-b border-border px-3">
              <WorkspaceSwitcher />
              <AppButton variant="ghost" size="icon-sm" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                <X aria-hidden />
              </AppButton>
            </div>
            <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
