import type { Metadata } from "next";

import { checkEntitlement } from "@/features/billing/server/entitlements";
import { StorageOverview } from "@/features/settings/components/storage-overview";
import { getWorkspaceStorage } from "@/features/settings/server/settings-service";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Storage" };

/**
 * Read-only, so it stays a Server Component, like the Usage tab beside it.
 *
 * The total has to be measured before the entitlement can be checked: storage
 * is not a metered key, so billing cannot count it - `current` is supplied by
 * the feature that owns the tables. See `entitlements.ts`.
 */
export default async function SettingsStoragePage({ params }: PageProps<"/w/[workspaceSlug]/settings/storage">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const storage = await getWorkspaceStorage(membership.workspace.id);
  const entitlement = await checkEntitlement(membership.workspace.id, "storageBytes", {
    current: storage.totalBytes,
  });

  return (
    <StorageOverview
      storage={storage}
      entitlement={entitlement}
      workspaceSlug={membership.workspace.slug}
      role={membership.role}
    />
  );
}
