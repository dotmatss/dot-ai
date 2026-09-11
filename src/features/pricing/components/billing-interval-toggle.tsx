"use client";

import { useId } from "react";

import { BILLING_INTERVALS, type BillingInterval } from "@/features/pricing/types";
import { cn } from "@/lib/cn";

const LABELS: Record<BillingInterval, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
};

/**
 * Monthly or yearly.
 *
 * A real radio group on native inputs, like the theme selector: arrow-key
 * navigation, the single tab stop and the "2 of 2, selected" announcement come
 * from the platform rather than from bespoke key handling. The inputs are
 * visually hidden but never removed from the accessibility tree.
 *
 * No discount is advertised, because no discount has been decided.
 */
export function BillingIntervalToggle({
  value,
  onChange,
  className,
}: {
  value: BillingInterval;
  onChange: (interval: BillingInterval) => void;
  className?: string;
}) {
  const groupName = useId();

  return (
    <fieldset className={cn("flex flex-col items-center gap-2", className)}>
      <legend className="sr-only">Billing interval</legend>
      <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 shadow-xs">
        {BILLING_INTERVALS.map((interval) => (
          <label key={interval} className="cursor-pointer">
            <input
              type="radio"
              name={groupName}
              value={interval}
              checked={value === interval}
              onChange={() => onChange(interval)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex items-center rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
                "text-foreground-muted peer-hover:text-foreground",
                "peer-checked:bg-accent peer-checked:text-accent-foreground",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-ring)]",
              )}
            >
              {LABELS[interval]}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
