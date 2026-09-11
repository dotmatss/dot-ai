import { normalizeTag } from "@/features/crm/normalize";
import { CONTACT_STAGES, type ContactListFilters, type ContactStage } from "@/features/crm/types";
import { DEFAULT_PAGE_SIZE } from "@/types/pagination";

type RawParams = Record<string, string | string[] | undefined>;

/** URL keys the contacts list reads and writes. */
export const CONTACT_FILTER_KEYS = ["q", "stage", "tag", "page"] as const;
export type ContactFilterKey = (typeof CONTACT_FILTER_KEYS)[number];

function first(values: RawParams, key: string): string | undefined {
  const value = values[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Normalizes raw URL parameters into list filters. Shared by the server page
 * (for prefetching) and the client list so both derive an identical query key,
 * which is what makes hydration hit rather than refetch.
 */
export function parseContactFilters(values: RawParams): ContactListFilters {
  const stageValue = first(values, "stage");
  const stage = stageValue && (CONTACT_STAGES as readonly string[]).includes(stageValue) ? (stageValue as ContactStage) : undefined;

  // The tag goes through the same normalization as stored tags, so a chip
  // built from a stored tag always matches what the repository compares.
  const tag = normalizeTag(first(values, "tag") ?? "");
  const page = Number(first(values, "page") ?? 1);
  const q = first(values, "q")?.trim();

  return {
    q: q || undefined,
    stage,
    tag: tag || undefined,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

export function hasActiveContactFilters(filters: ContactListFilters): boolean {
  return Boolean(filters.q || filters.stage || filters.tag);
}

/** Page number parsed from a detail tab's URL (notes, activity, conversations). */
export function parsePageParam(values: RawParams): number {
  const page = Number(first(values, "page") ?? 1);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}
