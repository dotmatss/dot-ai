import type { AuditEntry, AuditFacets, AuditListFilters } from "@/features/audit/types";
import { apiFetch, buildQueryString } from "@/lib/api/http";
import type { Paginated } from "@/types/pagination";

const base = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/audit`;

export const auditApi = {
  list: (workspaceSlug: string, filters: AuditListFilters) =>
    apiFetch<Paginated<AuditEntry>>(`${base(workspaceSlug)}${buildQueryString({ ...filters })}`),
  facets: (workspaceSlug: string) => apiFetch<AuditFacets>(`${base(workspaceSlug)}/facets`),
};
