"use client";

import { useSyncExternalStore } from "react";

import { formatDate, formatDateTime, formatRelativeTime } from "@/lib/format/date";
import { cn } from "@/lib/cn";

function subscribe(): () => void {
  return () => {};
}

/**
 * Renders a timestamp as "3 hours ago" without risking a hydration mismatch.
 *
 * A relative time computed during render differs between the server render and
 * the client's first render (they happen at different instants, and the server
 * has no idea of the viewer's clock). React would report that as a mismatch and
 * discard the markup. So the first client render matches the server exactly -
 * an absolute date - and the relative form appears once hydrated. The absolute
 * value stays available in the title and the machine-readable dateTime.
 */
export function AppRelativeTime({ value, className }: { value: string | Date; className?: string }) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const iso = typeof value === "string" ? value : value.toISOString();

  return (
    <time dateTime={iso} title={formatDateTime(value)} className={cn(className)}>
      {hydrated ? formatRelativeTime(value) : formatDate(value)}
    </time>
  );
}
