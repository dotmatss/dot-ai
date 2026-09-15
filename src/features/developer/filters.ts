import type { ApiKeyListFilters, ApiKeyStatusFilter } from "@/features/developer/types";
import { DEFAULT_PAGE_SIZE } from "@/types/pagination";

const STATUSES: readonly ApiKeyStatusFilter[] = ["active", "revoked"];

/**
 * Normalizes raw URL parameters into API key list filters. Shared by the server
 * page (for prefetching) and the client list so both derive identical query keys.
 */
export function parseApiKeyFilters(values: Record<string, string | string[] | undefined>): ApiKeyListFilters {
  const raw = (key: string) => {
    const value = values[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const statusValue = raw("status");
  const status = statusValue && (STATUSES as readonly string[]).includes(statusValue) ? (statusValue as ApiKeyStatusFilter) : undefined;
  const page = Number(raw("page") ?? 1);
  return {
    status,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}
