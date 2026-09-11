import { queryOptions, useQuery } from "@tanstack/react-query";

import { apiKeysApi, integrationsApi } from "@/features/integrations/api";
import type { ApiKeyListFilters } from "@/features/integrations/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export const integrationKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "integrations"] as const,
  list: (workspaceSlug: string) => [...integrationKeys.all(workspaceSlug), "list"] as const,
  apiKeys: (workspaceSlug: string) => [...integrationKeys.all(workspaceSlug), "api-keys"] as const,
  apiKeyList: (workspaceSlug: string, filters: ApiKeyListFilters) => [...integrationKeys.apiKeys(workspaceSlug), filters] as const,
};

/** Shared query definitions so server prefetch and client hooks agree on keys. */
export const integrationQueries = {
  list: (workspaceSlug: string) =>
    queryOptions({
      queryKey: integrationKeys.list(workspaceSlug),
      queryFn: () => integrationsApi.list(workspaceSlug),
    }),
  apiKeys: (workspaceSlug: string, filters: ApiKeyListFilters) =>
    queryOptions({
      queryKey: integrationKeys.apiKeyList(workspaceSlug, filters),
      queryFn: () => apiKeysApi.list(workspaceSlug, filters),
    }),
};

export function useIntegrationsQuery() {
  const { membership } = useWorkspace();
  return useQuery(integrationQueries.list(membership.workspace.slug));
}

export function useApiKeysQuery(filters: ApiKeyListFilters) {
  const { membership } = useWorkspace();
  return useQuery({ ...integrationQueries.apiKeys(membership.workspace.slug, filters), placeholderData: (previous) => previous });
}
