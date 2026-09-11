import type { ComponentPropsWithoutRef, ReactNode } from "react";

import type { BadgeTone } from "@/components/ui/app-badge";
import { cn } from "@/lib/cn";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE: Record<AvatarSize, string> = {
  xs: "size-6 text-caption",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-16 text-xl",
};

const STATUS_SIZE: Record<AvatarSize, string> = {
  xs: "size-1.5 ring-1",
  sm: "size-2 ring-2",
  md: "size-2.5 ring-2",
  lg: "size-3 ring-2",
  xl: "size-3.5 ring-2",
};

const STATUS_TONE: Record<Extract<BadgeTone, "success" | "warning" | "danger" | "neutral">, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-foreground-subtle",
};

// Decorative initials tones. Every pair is built from semantic tokens so the
// fill and its text flip together and keep their contrast in either theme.
const TONES = [
  "bg-accent text-accent-foreground",
  "bg-foreground-secondary text-surface",
  "bg-border text-foreground",
  "bg-surface-muted text-foreground-secondary",
];

export function initialsFromName(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

function toneFor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return TONES[Math.abs(hash) % TONES.length] ?? TONES[0]!;
}

export interface AppAvatarProps extends ComponentPropsWithoutRef<"span"> {
  name: string | null | undefined;
  src?: string | null;
  size?: AvatarSize;
  status?: keyof typeof STATUS_TONE;
  statusLabel?: string;
  shape?: "circle" | "square";
}

export function AppAvatar({
  name,
  src,
  size = "md",
  status,
  statusLabel,
  shape = "circle",
  className,
  ...props
}: AppAvatarProps) {
  const label = name ?? "Unknown user";
  return (
    <span
      className={cn("relative inline-flex shrink-0", SIZE[size], className)}
      role="img"
      aria-label={status ? `${label}, ${statusLabel ?? status}` : label}
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatars come from arbitrary user-provided hosts
        <img
          src={src}
          alt=""
          className={cn("size-full object-cover", shape === "circle" ? "rounded-full" : "rounded-md")}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "flex size-full select-none items-center justify-center font-semibold",
            shape === "circle" ? "rounded-full" : "rounded-md",
            toneFor(label),
          )}
        >
          {initialsFromName(name)}
        </span>
      )}
      {status ? (
        <span
          aria-hidden
          className={cn(
            "absolute bottom-0 right-0 rounded-full ring-surface",
            STATUS_SIZE[size],
            STATUS_TONE[status],
          )}
        />
      ) : null}
    </span>
  );
}

interface AppAvatarGroupProps {
  people: Array<{ name: string; src?: string | null }>;
  max?: number;
  size?: AvatarSize;
  className?: string;
  children?: ReactNode;
}

export function AppAvatarGroup({ people, max = 3, size = "sm", className }: AppAvatarGroupProps) {
  const visible = people.slice(0, max);
  const overflow = people.length - visible.length;
  return (
    <span className={cn("inline-flex items-center -space-x-2", className)}>
      {visible.map((person, index) => (
        <AppAvatar
          key={`${person.name}-${index}`}
          name={person.name}
          src={person.src}
          size={size}
          className="ring-2 ring-surface rounded-full"
        />
      ))}
      {overflow > 0 ? (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full border border-border bg-surface font-medium text-foreground-secondary ring-2 ring-surface",
            SIZE[size],
          )}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
