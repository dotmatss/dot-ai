import { PERIOD_META } from "@/features/analytics/constants";
import type { AnalyticsBucket, AnalyticsPeriod, TimeBucket } from "@/features/analytics/types";

/**
 * Bucket arithmetic for the analytics time series. Everything is UTC: the
 * server buckets in UTC so the labels a viewer sees match the rows the SQL
 * counted, regardless of where either of them sits.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AnalyticsRange {
  period: AnalyticsPeriod;
  /** Length of the window in days; the previous period is the same length. */
  days: number;
  bucket: AnalyticsBucket;
  /** Number of buckets in the window — also the number in the previous window. */
  bucketCount: number;
}

export function resolveAnalyticsRange(period: AnalyticsPeriod): AnalyticsRange {
  const meta = PERIOD_META[period];
  const bucketCount = meta.bucket === "week" ? Math.ceil(meta.days / 7) : meta.days;
  return { period, days: meta.days, bucket: meta.bucket, bucketCount };
}

export function bucketStepMs(bucket: AnalyticsBucket): number {
  return bucket === "week" ? 7 * DAY_MS : DAY_MS;
}

export interface AlignedBucket {
  index: number;
  /** Bucket start in the current period. */
  start: string;
  /** The matching bucket start one period earlier, or null when it is missing. */
  previousStart: string | null;
  current: number;
  previous: number;
}

/**
 * Zips the current and previous series index-by-index.
 *
 * The two series are produced by the same `generate_series` grid, so they
 * normally have identical lengths. This tolerates drift rather than trusting
 * it: a missing previous bucket reads as zero (a period with no rows *is* zero)
 * and extra previous buckets are dropped, because the chart's x-axis is the
 * current period.
 */
export function alignSeries(current: ReadonlyArray<TimeBucket>, previous: ReadonlyArray<TimeBucket>): AlignedBucket[] {
  return current.map((bucket, index) => {
    const prior = previous[index];
    return {
      index,
      start: bucket.start,
      previousStart: prior?.start ?? null,
      current: bucket.value,
      previous: prior?.value ?? 0,
    };
  });
}

const DAY_LABEL = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

/** Short axis label, e.g. "Mar 4". Deterministic (UTC), so it is hydration-safe. */
export function formatBucketLabel(start: string): string {
  return DAY_LABEL.format(new Date(start));
}

/** Full bucket span for the accessible table, e.g. "Mar 4 – Mar 10" for a week. */
export function formatBucketRange(start: string, bucket: AnalyticsBucket): string {
  if (bucket === "day") return formatBucketLabel(start);
  const end = new Date(new Date(start).getTime() + bucketStepMs(bucket) - DAY_MS);
  return `${formatBucketLabel(start)} – ${formatBucketLabel(end.toISOString())}`;
}

/**
 * Axis labels thinned so they never collide: 90 daily buckets cannot each carry
 * a date. Keeps the first and last, and every nth in between.
 */
export function axisLabelEvery(count: number, maxLabels = 8): number {
  return Math.max(1, Math.ceil(count / Math.max(1, maxLabels)));
}
