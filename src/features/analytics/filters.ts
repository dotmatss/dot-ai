import { DEFAULT_ANALYTICS_PERIOD } from "@/features/analytics/constants";
import { ANALYTICS_PERIODS, type AnalyticsPeriod } from "@/features/analytics/types";

type RawParams = Record<string, string | string[] | undefined>;

/** URL keys the analytics page reads and writes. */
export const ANALYTICS_FILTER_KEYS = ["period"] as const;
export type AnalyticsFilterKey = (typeof ANALYTICS_FILTER_KEYS)[number];

export interface AnalyticsFilters {
  period: AnalyticsPeriod;
}

function first(values: RawParams, key: string): string | undefined {
  const value = values[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Normalizes the `period` search param. Anything that is not one of the three
 * supported windows falls back to the default rather than throwing: the value
 * comes from the URL, so a stale bookmark or a hand-edited link must still
 * render a page instead of a 500.
 */
export function parseAnalyticsPeriod(value: string | string[] | undefined | null): AnalyticsPeriod {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return DEFAULT_ANALYTICS_PERIOD;
  const normalized = raw.trim().toLowerCase();
  return (ANALYTICS_PERIODS as readonly string[]).includes(normalized)
    ? (normalized as AnalyticsPeriod)
    : DEFAULT_ANALYTICS_PERIOD;
}

/** Shared by the server page and the period switcher so both agree on the window. */
export function parseAnalyticsFilters(values: RawParams): AnalyticsFilters {
  return { period: parseAnalyticsPeriod(first(values, "period")) };
}

/** True when the URL pins a period other than the default. */
export function hasExplicitPeriod(values: RawParams): boolean {
  const raw = first(values, "period");
  return typeof raw === "string" && parseAnalyticsPeriod(raw) !== DEFAULT_ANALYTICS_PERIOD;
}
