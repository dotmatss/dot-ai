import type { Metadata } from "next";

import { ContactNotesPanel } from "@/features/crm/components/contact-notes-panel";
import { parsePageParam } from "@/features/crm/filters";
import { crmKeys } from "@/features/crm/queries";
import { getContactNotes } from "@/features/crm/server/contact-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Contact notes" };

export default async function ContactNotesPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/crm/[contactId]/notes">) {
  const [{ workspaceSlug, contactId }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const page = parsePageParam(query);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    crmKeys.notes(workspaceSlug, contactId, page),
    await getContactNotes(membership.workspace.id, contactId, { page }),
  );

  return (
    <HydrateClient queryClient={queryClient}>
      <ContactNotesPanel contactId={contactId} />
    </HydrateClient>
  );
}
