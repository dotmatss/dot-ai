import type { Metadata } from "next";

import { getPlanLabel } from "@/features/billing/server/entitlements";
import { UsageOverview } from "@/features/settings/components/usage-overview";
import { getWorkspaceUsage } from "@/features/settings/server/settings-service";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Usage" };

/**
 * Read-only, so it stays a Server Component: there is nothing here for the
 * browser to do that would justify shipping the totals twice.
 */
export default async function SettingsUsagePage({ params }: PageProps<"/w/[workspaceSlug]/settings/usage">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const [usage, plan] = await Promise.all([
    getWorkspaceUsage(membership.workspace.id),
    getPlanLabel(membership.workspace.id),
  ]);

  return <UsageOverview usage={usage} plan={plan} />;
}
