import type { Metadata } from "next";

import { IntegrationsCatalog } from "@/features/integrations/components/integrations-catalog";
import { integrationKeys } from "@/features/integrations/queries";
import { getIntegrations } from "@/features/integrations/server/integration-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage({ params }: PageProps<"/w/[workspaceSlug]/integrations">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(integrationKeys.list(workspaceSlug), await getIntegrations(membership.workspace.id));

  return (
    <HydrateClient queryClient={queryClient}>
      <IntegrationsCatalog />
    </HydrateClient>
  );
}
