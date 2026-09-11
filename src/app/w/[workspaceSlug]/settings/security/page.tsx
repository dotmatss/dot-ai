import type { Metadata } from "next";

import { SessionsPanel } from "@/features/settings/components/sessions-panel";
import { settingsKeys } from "@/features/settings/queries";
import { getUserSessions, settingsActor } from "@/features/settings/server/settings-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Security" };

export default async function SettingsSecurityPage({ params }: PageProps<"/w/[workspaceSlug]/settings/security">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspaceAccess(workspaceSlug);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(settingsKeys.sessions(workspaceSlug), await getUserSessions(settingsActor(ctx)));

  return (
    <HydrateClient queryClient={queryClient}>
      <SessionsPanel />
    </HydrateClient>
  );
}
