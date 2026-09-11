import {
  COLLECTION_STATUSES,
  KNOWLEDGE_SOURCE_STATUSES,
  type CollectionListFilters,
  type CollectionStatus,
  type KnowledgeSourceListFilters,
  type KnowledgeSourceStatus,
} from "@/features/knowledge/types";
import { DEFAULT_PAGE_SIZE } from "@/types/pagination";

type RawParams = Record<string, string | string[] | undefined>;

function first(values: RawParams, key: string): string | undefined {
  const value = values[key];
  return Array.isArray(value) ? value[0] : value;
}

function toPage(raw: string | undefined): number {
  const page = Number(raw ?? 1);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function oneOf<T extends string>(raw: string | undefined, allowed: readonly string[]): T | undefined {
  return raw && allowed.includes(raw) ? (raw as T) : undefined;
}

/**
 * Normalizes raw URL parameters into list filters. Shared by the server page
 * (for prefetching) and the client list so both derive identical query keys.
 */
export function parseCollectionFilters(values: RawParams): CollectionListFilters {
  const q = first(values, "q")?.trim();
  return {
    q: q || undefined,
    status: oneOf<CollectionStatus>(first(values, "status"), COLLECTION_STATUSES),
    page: toPage(first(values, "page")),
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

export function parseKnowledgeSourceFilters(values: RawParams, pageSize = DEFAULT_PAGE_SIZE): KnowledgeSourceListFilters {
  const q = first(values, "q")?.trim();
  return {
    q: q || undefined,
    status: oneOf<KnowledgeSourceStatus>(first(values, "status"), KNOWLEDGE_SOURCE_STATUSES),
    page: toPage(first(values, "page")),
    pageSize,
  };
}
