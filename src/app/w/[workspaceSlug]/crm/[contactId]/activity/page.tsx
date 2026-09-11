import type { Metadata } from "next";

import { ContactActivityPanel } from "@/features/crm/components/contact-activity-panel";
import { parsePageParam } from "@/features/crm/filters";
import { crmKeys } from "@/features/crm/queries";
import { getContactTimeline } from "@/features/crm/server/contact-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Contact activity" };

export default async function ContactActivityPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/crm/[contactId]/activity">) {
  const [{ workspaceSlug, contactId }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const page = parsePageParam(query);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    crmKeys.activities(workspaceSlug, contactId, page),
    await getContactTimeline(membership.workspace.id, contactId, { page }),
  );

  return (
    <HydrateClient queryClient={queryClient}>
      <ContactActivityPanel contactId={contactId} />
    </HydrateClient>
  );
}
