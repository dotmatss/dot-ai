import type { Metadata } from "next";

import { WorkspaceGeneralForm } from "@/features/settings/components/workspace-general-form";
import { settingsKeys } from "@/features/settings/queries";
import { getWorkspaceGeneralSettings } from "@/features/settings/server/settings-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsGeneralPage({ params }: PageProps<"/w/[workspaceSlug]/settings">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspaceAccess(workspaceSlug);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(settingsKeys.general(workspaceSlug), getWorkspaceGeneralSettings(ctx));

  return (
    <HydrateClient queryClient={queryClient}>
      <WorkspaceGeneralForm />
    </HydrateClient>
  );
}
