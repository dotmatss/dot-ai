import type { Metadata } from "next";

import { MembersPanel } from "@/features/settings/components/members-panel";
import { settingsKeys } from "@/features/settings/queries";
import { getMembersOverview, settingsActor } from "@/features/settings/server/settings-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Members" };

export default async function SettingsMembersPage({ params }: PageProps<"/w/[workspaceSlug]/settings/members">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspaceAccess(workspaceSlug);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(settingsKeys.members(workspaceSlug), await getMembersOverview(settingsActor(ctx)));

  return (
    <HydrateClient queryClient={queryClient}>
      <MembersPanel />
    </HydrateClient>
  );
}
