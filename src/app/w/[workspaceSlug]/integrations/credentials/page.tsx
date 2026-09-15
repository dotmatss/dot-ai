import type { Metadata } from "next";

import { AppHeading, AppText } from "@/components/ui/app-typography";
import { AddCredentialButton } from "@/features/integrations/components/credential-dialog";
import { CredentialsPanel } from "@/features/integrations/components/credentials-panel";
import { parseCredentialFilters } from "@/features/integrations/filters";
import { integrationKeys } from "@/features/integrations/queries";
import { getCredentials } from "@/features/integrations/server/credential-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Credentials" };

export default async function CredentialsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/integrations/credentials">) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const filters = parseCredentialFilters(query);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    integrationKeys.credentialList(workspaceSlug, filters),
    await getCredentials(membership.workspace.id, filters),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <AppHeading level={2} className="text-lg">
            Credentials
          </AppHeading>
          <AppText size="sm" tone="muted">
            Tokens this workspace sends to other services. Encrypted at rest, never shown again, and attached by the
            server when a workflow step runs — so no token ever lives in a workflow definition.
          </AppText>
        </div>
        <AddCredentialButton />
      </div>
      <HydrateClient queryClient={queryClient}>
        <CredentialsPanel />
      </HydrateClient>
    </div>
  );
}
