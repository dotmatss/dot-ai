import { queryOptions, useQuery } from "@tanstack/react-query";

import { credentialsApi, integrationsApi } from "@/features/integrations/api";
import type { CredentialListFilters } from "@/features/integrations/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export const integrationKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "integrations"] as const,
  list: (workspaceSlug: string) => [...integrationKeys.all(workspaceSlug), "list"] as const,
  credentials: (workspaceSlug: string) => [...integrationKeys.all(workspaceSlug), "credentials"] as const,
  credentialList: (workspaceSlug: string, filters: CredentialListFilters) =>
    [...integrationKeys.credentials(workspaceSlug), filters] as const,
};

/** Shared query definitions so server prefetch and client hooks agree on keys. */
export const integrationQueries = {
  list: (workspaceSlug: string) =>
    queryOptions({
      queryKey: integrationKeys.list(workspaceSlug),
      queryFn: () => integrationsApi.list(workspaceSlug),
    }),
  credentials: (workspaceSlug: string, filters: CredentialListFilters) =>
    queryOptions({
      queryKey: integrationKeys.credentialList(workspaceSlug, filters),
      queryFn: () => credentialsApi.list(workspaceSlug, filters),
    }),
};

export function useIntegrationsQuery() {
  const { membership } = useWorkspace();
  return useQuery(integrationQueries.list(membership.workspace.slug));
}

export function useCredentialsQuery(filters: CredentialListFilters) {
  const { membership } = useWorkspace();
  return useQuery({
    ...integrationQueries.credentials(membership.workspace.slug, filters),
    placeholderData: (previous) => previous,
  });
}
