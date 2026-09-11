import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/cn";
import { formatNumber, formatSignedPercent } from "@/lib/format/number";

interface AnalyticsDeltaProps {
  /** `null` means "no percentage describes this change" - see `deltaPercent`. */
  delta: number | null;
  previous: number;
  suffix?: string;
  formatValue?: (value: number) => string;
  className?: string;
}

/**
 * Period-over-period change.
 *
 * When `deltaPercent` returns null the previous period was zero, and there is
 * no honest percentage for "0 -> 12" - so the raw comparison is shown instead
 * of a fabricated +100%.
 */
export function AnalyticsDelta({
  delta,
  previous,
  suffix = "vs previous period",
  formatValue = formatNumber,
  className,
}: AnalyticsDeltaProps) {
  const trend = delta === null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return (
    <p
      className={cn(
        // Inline-level on purpose: the parent's text alignment places it, so no
        // justify-* utility here can conflict with one a caller passes.
        "inline-flex items-center gap-1 text-xs font-medium",
        trend === "up" && "text-success",
        trend === "down" && "text-danger",
        (trend === null || trend === "flat") && "text-foreground-muted",
        className,
      )}
    >
      {trend === "up" ? <TrendingUp aria-hidden className="size-3.5" /> : null}
      {trend === "down" ? <TrendingDown aria-hidden className="size-3.5" /> : null}
      {trend === "flat" ? <Minus aria-hidden className="size-3.5" /> : null}
      {delta === null ? (
        <span className="font-normal">{formatValue(previous)} in the previous period</span>
      ) : (
        <>
          <span className="tabular-nums">{formatSignedPercent(delta)}</span>
          <span className="font-normal text-foreground-muted">{suffix}</span>
        </>
      )}
    </p>
  );
}
