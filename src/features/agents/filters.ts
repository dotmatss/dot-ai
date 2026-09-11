import { AGENT_STATUSES, type AgentListFilters, type AgentStatus } from "@/features/agents/types";
import { DEFAULT_PAGE_SIZE } from "@/types/pagination";

/**
 * Normalizes raw URL parameters into list filters. Shared by the server page
 * (for prefetching) and the client list so both sides derive identical query keys.
 */
export function parseAgentFilters(values: Record<string, string | string[] | undefined>): AgentListFilters {
  const raw = (key: string) => {
    const value = values[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const statusValue = raw("status");
  const status = statusValue && (AGENT_STATUSES as readonly string[]).includes(statusValue) ? (statusValue as AgentStatus) : undefined;
  const page = Number(raw("page") ?? 1);
  const q = raw("q")?.trim();
  return {
    q: q || undefined,
    status,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}
