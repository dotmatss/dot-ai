"use client";

import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";

interface MenuContextValue {
  close: (options?: { restoreFocus?: boolean }) => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

type Align = "start" | "end";

interface AppDropdownMenuProps {
  trigger: ReactElement<{ onClick?: (event: unknown) => void; ref?: Ref<HTMLElement> }>;
  children: ReactNode;
  align?: Align;
  /** Accessible name for the panel. */
  label?: string;
  /**
   * "menu" for a list of actions (arrow-key navigation between menu items).
   * "dialog" for a panel of ordinary content - static text inside role="menu"
   * is not exposed to assistive technology, so a notifications or summary
   * popover must not claim to be a menu.
   */
  contentRole?: "menu" | "dialog";
  className?: string;
}

interface Position {
  top: number;
  left: number;
}

const MENU_ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';

/**
 * Popover anchored to a trigger, following the WAI-ARIA menu button pattern.
 * Rendered in a portal with fixed positioning so it is never clipped by a
 * scrolling ancestor.
 */
export function AppDropdownMenu({
  trigger,
  children,
  align = "end",
  label,
  contentRole = "menu",
  className,
}: AppDropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const close = useCallback((options?: { restoreFocus?: boolean }) => {
    setOpen(false);
    // Activating an item removes the focused element from the document, which
    // would drop focus to <body> and lose the user's place. Dismissing by
    // clicking elsewhere must not steal focus back.
    if (options?.restoreFocus) triggerRef.current?.focus();
  }, []);

  const setTriggerRef = useCallback((node: HTMLElement | null) => {
    triggerRef.current = node;
  }, []);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    const menu = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuWidth = menu?.offsetWidth ?? 200;
    const menuHeight = menu?.offsetHeight ?? 0;
    const gap = 6;
    let left = align === "end" ? rect.right - menuWidth : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
    let top = rect.bottom + gap;
    if (menuHeight && top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - gap - menuHeight);
    }
    setPosition({ top, left });
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const first = menuRef.current?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR);
    if (first) first.focus();
    else menuRef.current?.focus();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, close, updatePosition]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    if (contentRole !== "menu") return;

    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    const index = items.findIndex((item) => item === document.activeElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
        break;
      case "Home":
        event.preventDefault();
        items[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      default:
        break;
    }
  }

  if (!isValidElement(trigger)) {
    throw new Error("AppDropdownMenu: trigger must be a single React element");
  }

  // eslint-disable-next-line react-hooks/refs -- the ref is forwarded through a stable callback, not read during render
  const triggerElement = cloneElement(trigger, {
    ref: setTriggerRef,
    "aria-haspopup": contentRole === "menu" ? "menu" : "dialog",
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
    onClick: (event: unknown) => {
      trigger.props.onClick?.(event);
      setOpen((value) => !value);
    },
  } as Record<string, unknown>);

  return (
    <MenuContext.Provider value={{ close }}>
      {triggerElement}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role={contentRole}
              aria-label={label}
              tabIndex={contentRole === "dialog" ? -1 : undefined}
              onKeyDown={onMenuKeyDown}
              style={position ? { top: position.top, left: position.left } : { visibility: "hidden" }}
              className={cn(
                "fixed z-50 min-w-44 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg",
                "animate-[menu-in_140ms_var(--ease-out-soft)]",
                className,
              )}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </MenuContext.Provider>
  );
}

interface AppDropdownMenuItemProps extends Omit<ComponentPropsWithoutRef<"button">, "onSelect"> {
  icon?: ReactNode;
  destructive?: boolean;
  onSelect?: () => void;
  shortcut?: string;
}

export function AppDropdownMenuItem({
  icon,
  destructive,
  onSelect,
  shortcut,
  className,
  children,
  disabled,
  ...props
}: AppDropdownMenuItemProps) {
  const menu = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onSelect?.();
        menu?.close({ restoreFocus: true });
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors",
        "focus:bg-surface-muted hover:bg-surface-muted disabled:cursor-not-allowed disabled:text-foreground-subtle",
        destructive ? "text-danger" : "text-foreground",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        !destructive && "[&_svg]:text-foreground-muted",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut ? <span className="text-caption text-foreground-subtle">{shortcut}</span> : null}
    </button>
  );
}

export function AppDropdownMenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}

export function AppDropdownMenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 py-1.5 text-caption font-medium uppercase tracking-wide text-foreground-muted">{children}</div>;
}
