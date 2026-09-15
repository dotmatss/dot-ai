import { queryOptions, useQuery } from "@tanstack/react-query";

import { apiKeysApi } from "@/features/developer/api";
import type { ApiKeyListFilters } from "@/features/developer/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export const developerKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "developer"] as const,
  apiKeys: (workspaceSlug: string) => [...developerKeys.all(workspaceSlug), "api-keys"] as const,
  apiKeyList: (workspaceSlug: string, filters: ApiKeyListFilters) => [...developerKeys.apiKeys(workspaceSlug), filters] as const,
};

/** Shared query definitions so server prefetch and client hooks agree on keys. */
export const developerQueries = {
  apiKeys: (workspaceSlug: string, filters: ApiKeyListFilters) =>
    queryOptions({
      queryKey: developerKeys.apiKeyList(workspaceSlug, filters),
      queryFn: () => apiKeysApi.list(workspaceSlug, filters),
    }),
};

export function useApiKeysQuery(filters: ApiKeyListFilters) {
  const { membership } = useWorkspace();
  return useQuery({ ...developerQueries.apiKeys(membership.workspace.slug, filters), placeholderData: (previous) => previous });
}
