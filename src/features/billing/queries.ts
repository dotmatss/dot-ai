import { queryOptions, useQuery } from "@tanstack/react-query";

import { billingApi } from "@/features/billing/api";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export const billingKeys = {
  all: (workspaceSlug: string) => ["workspaces", workspaceSlug, "billing"] as const,
  overview: (workspaceSlug: string) => [...billingKeys.all(workspaceSlug), "overview"] as const,
};

/** Shared definitions so server prefetch and client hooks agree on keys. */
export const billingQueries = {
  overview: (workspaceSlug: string) =>
    queryOptions({
      queryKey: billingKeys.overview(workspaceSlug),
      queryFn: () => billingApi.overview(workspaceSlug),
    }),
};

export function useBillingOverviewQuery() {
  const { membership } = useWorkspace();
  return useQuery(billingQueries.overview(membership.workspace.slug));
}
