"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";

type Side = "top" | "bottom" | "left" | "right";

interface AppTooltipProps {
  content: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  side?: Side;
  className?: string;
}

interface Position {
  top: number;
  left: number;
}

const GAP = 8;

/**
 * Tooltip shown on hover and on keyboard focus.
 *
 * Rendered into a portal with fixed positioning: an absolutely positioned
 * tooltip is clipped by any scrolling ancestor, which is exactly the case for
 * the collapsed sidebar, where the tooltip is the only label a control has.
 * The trigger must be focusable so keyboard users can reveal it.
 */
export function AppTooltip({ content, children, side = "top", className }: AppTooltipProps) {
  const id = useId();
  const [position, setPosition] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const show = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // First paint happens off-screen, then the measured size refines it.
    const width = tooltipRef.current?.offsetWidth ?? 0;
    const height = tooltipRef.current?.offsetHeight ?? 0;

    const byside: Record<Side, Position> = {
      top: { top: rect.top - height - GAP, left: rect.left + rect.width / 2 - width / 2 },
      bottom: { top: rect.bottom + GAP, left: rect.left + rect.width / 2 - width / 2 },
      left: { top: rect.top + rect.height / 2 - height / 2, left: rect.left - width - GAP },
      right: { top: rect.top + rect.height / 2 - height / 2, left: rect.right + GAP },
    };
    const next = byside[side];
    setPosition({
      top: Math.max(8, Math.min(next.top, window.innerHeight - height - 8)),
      left: Math.max(8, Math.min(next.left, window.innerWidth - width - 8)),
    });
  }, [side]);

  const hide = useCallback(() => setPosition(null), []);

  const setTriggerRef = useCallback(
    (node: HTMLElement | null) => {
      triggerRef.current = node;
    },
    [],
  );

  if (!isValidElement(children)) return children;

  // eslint-disable-next-line react-hooks/refs -- the ref is forwarded through a stable callback, not read during render
  const trigger = cloneElement(children, {
    ref: setTriggerRef,
    "aria-describedby": position ? id : undefined,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  } as Record<string, unknown>);

  return (
    <>
      {trigger}
      {position && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tooltipRef}
              role="tooltip"
              id={id}
              style={{ top: position.top, left: position.left }}
              className={cn(
                "pointer-events-none fixed z-60 max-w-xs whitespace-nowrap rounded-md bg-surface-inverted px-2.5 py-1.5 text-xs font-medium text-foreground-inverted shadow-md",
                className,
              )}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
