"use client";

import { Bell, Menu, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type KeyboardEvent } from "react";

import { AppButton } from "@/components/ui/app-button";
import { AppDropdownMenu } from "@/components/ui/app-dropdown-menu";
import { AppInput } from "@/components/ui/app-input";
import { workspaceNavigation } from "@/config/navigation";
import { UserMenu } from "@/features/auth/components/user-menu";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { cn } from "@/lib/cn";
import { useUiPreferences } from "@/stores/ui-preferences-store";

/**
 * Quick navigation: filters workspace sections as the user types and jumps to
 * the highlighted one. Implemented as a combobox with aria-activedescendant, so
 * the results are reachable from the keyboard without moving focus out of the
 * input (which would close the list before a click could land).
 */
function QuickNav() {
  const { membership } = useWorkspace();
  const router = useRouter();
  const listId = useId();
  const [term, setTerm] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    return workspaceNavigation
      .flatMap((group) => group.items)
      .filter((item) => item.label.toLowerCase().includes(q))
      .slice(0, 6);
  }, [term]);

  const open = focused && matches.length > 0;
  const activeOptionId = open ? `${listId}-option-${Math.min(activeIndex, matches.length - 1)}` : undefined;

  function go(index: number) {
    const target = matches[index];
    if (!target) return;
    router.push(target.href(membership.workspace.slug));
    setTerm("");
    setFocused(false);
    setActiveIndex(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % matches.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + matches.length) % matches.length);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(matches.length - 1);
        break;
      case "Enter":
        event.preventDefault();
        go(Math.min(activeIndex, matches.length - 1));
        break;
      case "Escape":
        event.preventDefault();
        setTerm("");
        setFocused(false);
        break;
      default:
        break;
    }
  }

  return (
    <div className="relative w-full max-w-md">
      <AppInput
        type="search"
        role="combobox"
        aria-label="Search workspace sections"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        placeholder="Jump to…"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setActiveIndex(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onKeyDown={onKeyDown}
        leadingIcon={<Search aria-hidden />}
        className="[&::-webkit-search-cancel-button]:hidden"
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Workspace sections"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {matches.map((item, index) => {
            const Icon = item.icon;
            const selected = index === Math.min(activeIndex, matches.length - 1);
            return (
              <li
                key={item.key}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={selected}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => go(index)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                  selected && "bg-surface-muted",
                )}
              >
                <Icon aria-hidden className="size-4 text-foreground-muted" />
                {item.label}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function Topbar() {
  const setMobileOpen = useUiPreferences((s) => s.setMobileNavOpen);

  return (
    <header className="sticky top-0 z-20 flex h-topbar items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur supports-backdrop-filter:bg-surface/80 sm:px-6">
      <AppButton
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Menu aria-hidden />
      </AppButton>
      <div className="flex flex-1 items-center">
        <QuickNav />
      </div>
      <div className="flex items-center gap-1.5">
        <AppDropdownMenu
          label="Notifications"
          // A panel of ordinary content, not a list of actions: text inside
          // role="menu" is not exposed to assistive technology.
          contentRole="dialog"
          className="min-w-64"
          trigger={
            <AppButton variant="ghost" size="icon" aria-label="Notifications">
              <Bell aria-hidden />
            </AppButton>
          }
        >
          <div className="px-3 py-6 text-center">
            <p className="text-sm font-medium">No new notifications</p>
            <p className="mt-1 text-xs text-foreground-muted">Alerts for escalations and failed runs will appear here.</p>
          </div>
        </AppDropdownMenu>
        <UserMenu />
      </div>
    </header>
  );
}
