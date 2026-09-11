import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

import { AppCard } from "@/components/ui/app-card";
import { cn } from "@/lib/cn";
import { formatSignedPercent } from "@/lib/format/number";

interface AppStatProps {
  label: string;
  value: ReactNode;
  /** Percentage change versus the comparison period. */
  delta?: number | null;
  deltaLabel?: string;
  hint?: ReactNode;
  visual?: ReactNode;
  className?: string;
}

export function AppStat({ label, value, delta, deltaLabel = "vs last period", hint, visual, className }: AppStatProps) {
  const trend = delta === undefined || delta === null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return (
    <AppCard padding="md" className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-foreground-muted">{label}</p>
        {hint}
      </div>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
          {trend ? (
            <p
              className={cn(
                "mt-1 inline-flex items-center gap-1 text-xs font-medium",
                trend === "up" && "text-success",
                trend === "down" && "text-danger",
                trend === "flat" && "text-foreground-muted",
              )}
            >
              {trend === "up" ? <TrendingUp className="size-3.5" aria-hidden /> : null}
              {trend === "down" ? <TrendingDown className="size-3.5" aria-hidden /> : null}
              {trend === "flat" ? <Minus className="size-3.5" aria-hidden /> : null}
              <span>{formatSignedPercent(delta ?? 0)}</span>
              <span className="font-normal text-foreground-muted">{deltaLabel}</span>
            </p>
          ) : null}
        </div>
        {visual ? <div className="shrink-0">{visual}</div> : null}
      </div>
    </AppCard>
  );
}
