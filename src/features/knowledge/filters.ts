import {
  KNOWLEDGE_BASE_STATUSES,
  type KnowledgeBaseListFilters,
  type KnowledgeBaseStatus,
  type KnowledgeSourceListFilters,
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

/**
 * Normalizes raw URL parameters into list filters. Shared by the server page
 * (for prefetching) and the client list so both derive identical query keys.
 */
export function parseKnowledgeBaseFilters(values: RawParams): KnowledgeBaseListFilters {
  const statusValue = first(values, "status");
  const status =
    statusValue && (KNOWLEDGE_BASE_STATUSES as readonly string[]).includes(statusValue)
      ? (statusValue as KnowledgeBaseStatus)
      : undefined;
  const q = first(values, "q")?.trim();
  return {
    q: q || undefined,
    status,
    page: toPage(first(values, "page")),
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

export function parseKnowledgeSourceFilters(values: RawParams, pageSize = DEFAULT_PAGE_SIZE): KnowledgeSourceListFilters {
  return { page: toPage(first(values, "page")), pageSize };
}
