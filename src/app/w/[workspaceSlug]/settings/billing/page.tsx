import type { Metadata } from "next";

import { BillingPanel } from "@/features/billing/components/billing-overview";
import { billingKeys } from "@/features/billing/queries";
import { getBillingOverview } from "@/features/billing/server/billing-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Billing" };

export default async function SettingsBillingPage({ params }: PageProps<"/w/[workspaceSlug]/settings/billing">) {
  const { workspaceSlug } = await params;
  // Admin: the plan and what it allows is an administrative view of the whole
  // workspace, not an ordinary read. The API handler enforces the same floor,
  // and changing the plan is owner-only on top of that.
  const { membership } = await requireWorkspaceAccess(workspaceSlug, "admin");

  const queryClient = makeQueryClient();
  queryClient.setQueryData(billingKeys.overview(workspaceSlug), await getBillingOverview(membership.workspace.id));

  return (
    <HydrateClient queryClient={queryClient}>
      <BillingPanel />
    </HydrateClient>
  );
}
