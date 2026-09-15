import { TOPIC_SORTS, type TopicListFilters, type TopicSort } from "@/features/intelligence/types";
import { DEFAULT_PAGE_SIZE } from "@/types/pagination";

type RawParams = Record<string, string | string[] | undefined>;

/** URL keys the topic list reads and writes. */
export const TOPIC_FILTER_KEYS = ["q", "gaps", "sort", "page"] as const;
export type TopicFilterKey = (typeof TOPIC_FILTER_KEYS)[number];

export const DEFAULT_TOPIC_SORT: TopicSort = "volume";

function first(values: RawParams, key: string): string | undefined {
  const value = values[key];
  return Array.isArray(value) ? value[0] : value;
}

export function parseTopicSort(value: string | string[] | undefined | null): TopicSort {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return DEFAULT_TOPIC_SORT;
  const normalized = raw.trim().toLowerCase();
  return (TOPIC_SORTS as readonly string[]).includes(normalized) ? (normalized as TopicSort) : DEFAULT_TOPIC_SORT;
}

/**
 * Normalizes raw URL parameters into topic list filters.
 *
 * Shared by the server page (which prefetches with them) and the client list
 * (which refetches with them), so both derive an identical query key and
 * hydration hits the cache instead of firing a second request.
 *
 * Nothing here throws. Every value arrives from a URL, so a stale bookmark or a
 * hand-edited link has to render a page rather than a 500.
 */
export function parseTopicFilters(values: RawParams): TopicListFilters {
  const page = Number(first(values, "page") ?? 1);
  const search = first(values, "q")?.trim();

  return {
    search: search || undefined,
    // Presence is the signal, as it is for any checkbox in a URL: `?gaps` and
    // `?gaps=1` both mean on, and only an explicit "0"/"false" means off.
    gapsOnly: parseFlag(first(values, "gaps")),
    sort: parseTopicSort(first(values, "sort")),
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

function parseFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "0" || normalized === "false") return undefined;
  return true;
}

export function hasActiveTopicFilters(filters: TopicListFilters): boolean {
  return Boolean(filters.search || filters.gapsOnly || filters.sort !== DEFAULT_TOPIC_SORT);
}
