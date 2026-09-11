"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/cn";

/* -------------------------------------------------------------------------- */
/* Route tabs: navigation between sibling routes                               */
/* -------------------------------------------------------------------------- */

export interface AppTabNavItem<T extends string = string> {
  href: Route<T> | (string & {});
  label: string;
  /** Match nested routes too (default: exact match). */
  matchPrefix?: boolean;
  badge?: ReactNode;
}

interface AppTabNavProps {
  items: ReadonlyArray<AppTabNavItem>;
  label: string;
  className?: string;
}

const TAB_BASE =
  "relative -mb-px inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-medium transition-colors focus-ring rounded-t-sm";
const TAB_ACTIVE = "border-foreground text-foreground";
const TAB_INACTIVE = "border-transparent text-foreground-muted hover:border-border-strong hover:text-foreground";

export function AppTabNav({ items, label, className }: AppTabNavProps) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className={cn("border-b border-border", className)}>
      <ul className="-mb-px flex gap-5 overflow-x-auto scrollbar-thin">
        {items.map((item) => {
          const href = String(item.href);
          const active = item.matchPrefix ? pathname === href || pathname.startsWith(`${href}/`) : pathname === href;
          return (
            <li key={href} className="shrink-0">
              <Link
                href={item.href as Route}
                aria-current={active ? "page" : undefined}
                className={cn(TAB_BASE, active ? TAB_ACTIVE : TAB_INACTIVE)}
              >
                {item.label}
                {item.badge}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Stateful tabs: switching panels within a page                               */
/* -------------------------------------------------------------------------- */

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`${component} must be used within <AppTabs>`);
  return ctx;
}

interface AppTabsProps {
  value?: string;
  defaultValue: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function AppTabs({ value, defaultValue, onValueChange, children, className }: AppTabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const baseId = useId();
  const current = value ?? internal;
  const setValue = (next: string) => {
    setInternal(next);
    onValueChange?.(next);
  };
  return (
    <TabsContext.Provider value={{ value: current, setValue, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

type TabListVariant = "underline" | "pill";

export function AppTabList({
  label,
  variant = "underline",
  className,
  children,
}: {
  label: string;
  variant?: TabListVariant;
  className?: string;
  children: ReactNode;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
    const index = tabs.findIndex((tab) => tab === document.activeElement);
    if (index === -1) return;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        variant === "underline"
          ? "flex gap-5 border-b border-border overflow-x-auto scrollbar-thin"
          : "inline-flex gap-1 rounded-lg border border-border bg-surface-muted p-1",
        className,
      )}
      data-variant={variant}
    >
      {children}
    </div>
  );
}

interface AppTabProps extends ComponentPropsWithoutRef<"button"> {
  value: string;
  variant?: TabListVariant;
}

export function AppTab({ value, variant = "underline", className, children, ...props }: AppTabProps) {
  const ctx = useTabsContext("AppTab");
  const selected = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${ctx.baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => ctx.setValue(value)}
      className={cn(
        variant === "underline"
          ? cn(TAB_BASE, selected ? TAB_ACTIVE : TAB_INACTIVE)
          : cn(
              "inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-ring",
              selected ? "bg-surface text-foreground shadow-xs" : "text-foreground-muted hover:text-foreground",
            ),
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function AppTabPanel({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  const ctx = useTabsContext("AppTabPanel");
  if (ctx.value !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${value}`}
      aria-labelledby={`${ctx.baseId}-tab-${value}`}
      tabIndex={0}
      className={cn("focus-ring rounded-md", className)}
    >
      {children}
    </div>
  );
}
