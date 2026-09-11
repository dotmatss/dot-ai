import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "purple" | "pink" | "inverted";
type BadgeVariant = "soft" | "outline" | "solid";
type BadgeSize = "sm" | "md";

const SOFT: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-foreground-secondary border-transparent",
  info: "bg-info-bg text-info border-transparent",
  success: "bg-success-bg text-success border-transparent",
  warning: "bg-warning-bg text-warning border-transparent",
  danger: "bg-danger-bg text-danger border-transparent",
  purple: "bg-purple-bg text-purple border-transparent",
  pink: "bg-pink-bg text-pink border-transparent",
  inverted: "bg-surface-inverted text-foreground-inverted border-transparent",
};

const OUTLINE: Record<BadgeTone, string> = {
  neutral: "bg-surface text-foreground-secondary border-border",
  info: "bg-surface text-info border-info-border",
  success: "bg-surface text-success border-success-border",
  warning: "bg-surface text-warning border-warning-border",
  danger: "bg-surface text-danger border-danger-border",
  purple: "bg-surface text-purple border-purple-border",
  pink: "bg-surface text-pink border-pink-border",
  inverted: "bg-surface text-foreground border-foreground",
};

// The status tones lighten on a dark ground, so the label on a solid fill has
// to flip with them: `accent-foreground` is white in the light theme and near
// black in the dark one, which is what keeps these readable in both.
const SOLID: Record<BadgeTone, string> = {
  neutral: "bg-foreground-secondary text-surface border-transparent",
  info: "bg-info text-accent-foreground border-transparent",
  success: "bg-success text-accent-foreground border-transparent",
  warning: "bg-warning text-accent-foreground border-transparent",
  danger: "bg-danger text-accent-foreground border-transparent",
  purple: "bg-purple text-accent-foreground border-transparent",
  pink: "bg-pink text-accent-foreground border-transparent",
  inverted: "bg-surface-inverted text-foreground-inverted border-transparent",
};

const DOT: Record<BadgeTone, string> = {
  neutral: "bg-foreground-subtle",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  purple: "bg-purple",
  pink: "bg-pink",
  inverted: "bg-foreground",
};

export interface AppBadgeProps extends ComponentPropsWithoutRef<"span"> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  icon?: ReactNode;
}

export function AppBadge({
  tone = "neutral",
  variant = "soft",
  size = "md",
  dot,
  icon,
  className,
  children,
  ...props
}: AppBadgeProps) {
  const palette = variant === "soft" ? SOFT : variant === "outline" ? OUTLINE : SOLID;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-medium",
        size === "sm" ? "h-5 px-2 text-caption" : "h-6 px-2.5 text-xs",
        palette[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden className={cn("size-1.5 rounded-full", DOT[tone])} /> : null}
      {icon ? <span className="[&_svg]:size-3">{icon}</span> : null}
      {children}
    </span>
  );
}

export function AppStatusDot({ tone = "neutral", className, label }: { tone?: BadgeTone; className?: string; label?: string }) {
  return (
    <span
      className={cn("inline-block size-2 shrink-0 rounded-full", DOT[tone], className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** Counter badge (e.g. unread counts). */
export function AppCountBadge({ count, max = 99, className }: { count: number; max?: number; className?: string }) {
  if (count <= 0) return null;
  const display = count > max ? `${max}+` : String(count);
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-caption font-semibold text-accent-foreground",
        className,
      )}
    >
      {display}
    </span>
  );
}
