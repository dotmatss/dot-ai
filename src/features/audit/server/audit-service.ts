import "server-only";

import {
  listAuditEntries,
  listAuditFacets,
  listRecentAuditEntries,
} from "@/features/audit/server/audit-repository";
import type { AuditEntry, AuditFacets, AuditListFilters } from "@/features/audit/types";
import type { Paginated } from "@/types/pagination";

/**
 * The audit feature's read surface.
 *
 * There are no writes here on purpose: entries are appended by
 * `recordActivity()` from the service that performed the action, because only
 * that service knows what actually happened. An audit log that can be written
 * through its own endpoint is a log that can be forged through it.
 *
 * Every function takes a workspace id resolved from a verified membership. The
 * admin floor that guards the full log lives on the route handler and the page;
 * `listRecentActivity` is deliberately *not* admin-gated, because the dashboard
 * card it feeds is viewer-visible and shows only summaries.
 */

export function getAuditLog(workspaceId: string, filters: AuditListFilters): Promise<Paginated<AuditEntry>> {
  return listAuditEntries(workspaceId, filters);
}

export function getAuditFacets(workspaceId: string): Promise<AuditFacets> {
  return listAuditFacets(workspaceId);
}

export function listRecentActivity(workspaceId: string, limit = 10): Promise<AuditEntry[]> {
  return listRecentAuditEntries(workspaceId, limit);
}
