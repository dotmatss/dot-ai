"use client";

import { X } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

interface AppChipProps extends Omit<ComponentPropsWithoutRef<"button">, "type"> {
  selected?: boolean;
  leadingIcon?: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}

/**
 * Chip used for filters, choices and removable tokens.
 *
 * Three shapes, chosen by the handlers given: a plain token, a single button
 * when the whole chip is selectable, and a token wrapping two sibling buttons
 * when it is both selectable and removable. That last case must not nest the
 * remove button inside the chip button - nested buttons are invalid HTML and
 * leave assistive technology with an ambiguous target.
 */
export function AppChip({
  selected,
  leadingIcon,
  onRemove,
  removeLabel,
  className,
  children,
  onClick,
  disabled,
  ...props
}: AppChipProps) {
  const surface = cn(
    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border text-xs font-medium transition-colors",
    selected ? "border-accent bg-accent text-accent-foreground" : "border-border bg-surface text-foreground-secondary",
    onClick && !selected && "hover:border-border-strong hover:text-foreground",
    disabled && "cursor-not-allowed opacity-60",
    "[&_svg]:size-3.5",
    className,
  );

  const content = (
    <>
      {leadingIcon}
      <span className="truncate">{children}</span>
    </>
  );

  const removeButton = onRemove ? (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
      disabled={disabled}
      aria-label={removeLabel ?? `Remove ${typeof children === "string" ? children : "item"}`}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full focus-ring",
        selected ? "hover:bg-accent-foreground/15" : "hover:bg-surface-muted",
      )}
    >
      <X aria-hidden />
    </button>
  ) : null;

  if (onClick && onRemove) {
    return (
      <span className={cn(surface, "pl-3 pr-1.5")}>
        <button
          type="button"
          aria-pressed={selected}
          onClick={onClick}
          disabled={disabled}
          className="inline-flex min-w-0 items-center gap-1.5 rounded-full focus-ring"
          {...props}
        >
          {content}
        </button>
        {removeButton}
      </span>
    );
  }

  if (onClick) {
    return (
      <button type="button" aria-pressed={selected} onClick={onClick} disabled={disabled} className={cn(surface, "px-3 focus-ring")} {...props}>
        {content}
      </button>
    );
  }

  return <span className={cn(surface, onRemove ? "pl-3 pr-1.5" : "px-3")}>{content}{removeButton}</span>;
}
