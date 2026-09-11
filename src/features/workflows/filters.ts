import {
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_STATUSES,
  type WorkflowListFilters,
  type WorkflowRunListFilters,
  type WorkflowRunStatus,
  type WorkflowStatus,
} from "@/features/workflows/types";
import { DEFAULT_PAGE_SIZE } from "@/types/pagination";

/**
 * Normalizes raw URL parameters into list filters. Shared by the server pages
 * (for prefetching) and the client lists so both sides derive identical query
 * keys and the hydrated cache is used instead of an immediate refetch.
 */

function first(values: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = values[key];
  return Array.isArray(value) ? value[0] : value;
}

function normalizePageParam(raw: string | undefined): number {
  const page = Number(raw ?? 1);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

export function parseWorkflowFilters(values: Record<string, string | string[] | undefined>): WorkflowListFilters {
  const statusValue = first(values, "status");
  const status =
    statusValue && (WORKFLOW_STATUSES as readonly string[]).includes(statusValue) ? (statusValue as WorkflowStatus) : undefined;
  const q = first(values, "q")?.trim();
  return {
    q: q || undefined,
    status,
    page: normalizePageParam(first(values, "page")),
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

export function parseWorkflowRunFilters(values: Record<string, string | string[] | undefined>): WorkflowRunListFilters {
  const statusValue = first(values, "runStatus");
  const status =
    statusValue && (WORKFLOW_RUN_STATUSES as readonly string[]).includes(statusValue)
      ? (statusValue as WorkflowRunStatus)
      : undefined;
  return {
    status,
    page: normalizePageParam(first(values, "runPage")),
    pageSize: DEFAULT_PAGE_SIZE,
  };
}
