import type { Metadata } from "next";

import { ProfileForm } from "@/features/settings/components/profile-form";
import { settingsKeys } from "@/features/settings/queries";
import { getUserProfile, settingsActor } from "@/features/settings/server/settings-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Profile" };

export default async function SettingsProfilePage({ params }: PageProps<"/w/[workspaceSlug]/settings/profile">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspaceAccess(workspaceSlug);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(settingsKeys.profile(workspaceSlug), await getUserProfile(settingsActor(ctx)));

  return (
    <HydrateClient queryClient={queryClient}>
      <ProfileForm />
    </HydrateClient>
  );
}
