import { queryOptions, useQuery } from "@tanstack/react-query";

import { auditApi } from "@/features/audit/api";
import type { AuditListFilters } from "@/features/audit/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export const auditKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "audit"] as const,
  lists: (workspaceSlug: string) => [...auditKeys.all(workspaceSlug), "list"] as const,
  list: (workspaceSlug: string, filters: AuditListFilters) => [...auditKeys.lists(workspaceSlug), filters] as const,
  facets: (workspaceSlug: string) => [...auditKeys.all(workspaceSlug), "facets"] as const,
};

export const auditQueries = {
  list: (workspaceSlug: string, filters: AuditListFilters) =>
    queryOptions({
      queryKey: auditKeys.list(workspaceSlug, filters),
      queryFn: () => auditApi.list(workspaceSlug, filters),
    }),
  facets: (workspaceSlug: string) =>
    queryOptions({
      queryKey: auditKeys.facets(workspaceSlug),
      queryFn: () => auditApi.facets(workspaceSlug),
      // The set of entity types and actors in a workspace moves slowly; the
      // filter controls do not need to refetch on every focus.
      staleTime: 5 * 60_000,
    }),
};

export function useAuditListQuery(filters: AuditListFilters) {
  const { membership } = useWorkspace();
  return useQuery(auditQueries.list(membership.workspace.slug, filters));
}

export function useAuditFacetsQuery() {
  const { membership } = useWorkspace();
  return useQuery(auditQueries.facets(membership.workspace.slug));
}
