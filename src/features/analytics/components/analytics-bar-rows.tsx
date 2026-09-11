import { barHeightPercent } from "@/features/analytics/chart-geometry";
import { shareOfTotal } from "@/features/analytics/metrics";
import { cn } from "@/lib/cn";
import { formatNumber, formatPercent } from "@/lib/format/number";

export interface AnalyticsBarRow {
  id: string;
  label: string;
  value: number;
  /** Optional second line, e.g. what the row actually counts. */
  hint?: string;
}

interface AnalyticsBarRowsProps {
  rows: ReadonlyArray<AnalyticsBarRow>;
  /** Denominator for the share column - the real total, not the sum of the rows shown. */
  total: number;
  /** Noun for the number, e.g. "conversations". */
  valueLabel: string;
  formatValue?: (value: number) => string;
  className?: string;
}

/**
 * Ranked horizontal bars.
 *
 * Every number is written out next to its label, so the bar itself carries no
 * information and is hidden from assistive technology. Bars are scaled to the
 * largest row (so the shape is readable) while the percentage is the share of
 * the true total (so the number is honest).
 */
export function AnalyticsBarRows({
  rows,
  total,
  valueLabel,
  formatValue = formatNumber,
  className,
}: AnalyticsBarRowsProps) {
  const max = rows.reduce((highest, row) => (row.value > highest ? row.value : highest), 0);

  return (
    <ul className={cn("flex flex-col gap-3.5", className)}>
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{row.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-foreground-muted">
              <span className="text-sm font-medium text-foreground">{formatValue(row.value)}</span> {valueLabel} ·{" "}
              {formatPercent(shareOfTotal(row.value, total))}
            </span>
          </div>
          <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-foreground" style={{ width: `${barHeightPercent(row.value, max)}%` }} />
          </div>
          {row.hint ? <p className="text-xs text-foreground-muted">{row.hint}</p> : null}
        </li>
      ))}
    </ul>
  );
}
