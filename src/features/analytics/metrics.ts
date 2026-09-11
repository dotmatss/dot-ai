import type { MetricComparison, TimeBucket } from "@/features/analytics/types";

/**
 * Pure metric maths shared by every analytics section. Nothing here touches the
 * database or the DOM, which is what makes the numbers on the page testable.
 */

/**
 * Period-over-period change as a percentage.
 *
 * Returns `null` when the previous period was zero and the current one is not:
 * there is no percentage that describes "0 → 12", and rendering `+Infinity%`
 * (or a fabricated `+100%`) would be a lie. Callers show the raw comparison
 * instead. Two zeroes are genuinely unchanged, so that is `0`.
 */
export function deltaPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function comparisonDelta(comparison: MetricComparison): number | null {
  return deltaPercent(comparison.current, comparison.previous);
}

/** Share of a total, 0–100. A non-positive total has no shares, so every share is 0. */
export function shareOfTotal(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0 || value <= 0) return 0;
  return Math.min(100, (value / total) * 100);
}

/** Success rate of a run set, 0–100. No runs means nothing succeeded *or* failed. */
export function successRate(succeeded: number, total: number): number {
  return shareOfTotal(succeeded, total);
}

export function seriesTotal(buckets: ReadonlyArray<TimeBucket>): number {
  return buckets.reduce((sum, bucket) => sum + bucket.value, 0);
}

export function seriesMax(buckets: ReadonlyArray<TimeBucket>): number {
  return buckets.reduce((max, bucket) => (bucket.value > max ? bucket.value : max), 0);
}

export interface RankedRow {
  /** Stable React key. Rows without a domain id (the "Other" bucket) use a sentinel. */
  id: string;
  label: string;
  value: number;
}

export const OTHER_ROW_ID = "__other__";

/**
 * Ranks rows by value and collapses everything past `limit` into a single
 * "Other" row, so a workspace with 200 chatbots still gets a readable chart
 * without the tail being silently dropped.
 */
export function rankWithOther(rows: ReadonlyArray<RankedRow>, limit: number, otherLabel = "Other"): RankedRow[] {
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  if (limit <= 0) return [];
  if (sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit);
  const tailTotal = sorted.slice(limit).reduce((sum, row) => sum + row.value, 0);
  if (tailTotal <= 0) return head;
  return [...head, { id: OTHER_ROW_ID, label: otherLabel, value: tailTotal }];
}
