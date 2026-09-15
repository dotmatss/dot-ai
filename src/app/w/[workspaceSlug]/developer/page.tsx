import type { Metadata } from "next";

import { AppHeading, AppText } from "@/components/ui/app-typography";
import { getServerEnv } from "@/config/env";
import { ApiKeysPanel } from "@/features/developer/components/api-keys-panel";
import { ApiUsageExample } from "@/features/developer/components/api-usage-example";
import { CreateApiKeyButton } from "@/features/developer/components/create-api-key-dialog";
import { parseApiKeyFilters } from "@/features/developer/filters";
import { developerKeys } from "@/features/developer/queries";
import { getApiKeys } from "@/features/developer/server/api-key-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "API keys" };

export default async function ApiKeysPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/developer">) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const filters = parseApiKeyFilters(query);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    developerKeys.apiKeyList(workspaceSlug, filters),
    await getApiKeys(membership.workspace.id, filters),
  );

  const origin = getServerEnv().APP_URL.replace(/\/$/, "");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <AppHeading level={2} className="text-lg">
            API keys
          </AppHeading>
          <AppText size="sm" tone="muted">
            Each key authenticates a caller as this workspace. Keys are shown once, stored only as a hash, and can be
            revoked at any time.
          </AppText>
        </div>
        <CreateApiKeyButton />
      </div>
      <HydrateClient queryClient={queryClient}>
        <ApiKeysPanel />
      </HydrateClient>
      <ApiUsageExample origin={origin} />
    </div>
  );
}
