import type { Metadata } from "next";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { ContactsList } from "@/features/crm/components/contacts-list";
import { CreateContactButton, ImportContactsButton } from "@/features/crm/components/create-contact-dialog";
import { parseContactFilters } from "@/features/crm/filters";
import { crmKeys } from "@/features/crm/queries";
import { getContacts, getContactTags } from "@/features/crm/server/contact-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "CRM" };

export default async function CrmPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/crm">) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const filters = parseContactFilters(query);

  // Tags are seeded too: the filter menu is one click away and the create
  // dialog offers them as suggestions, so both would otherwise fetch on mount.
  const [contacts, tags] = await Promise.all([
    getContacts(membership.workspace.id, filters),
    getContactTags(membership.workspace.id),
  ]);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(crmKeys.list(workspaceSlug, filters), contacts);
  queryClient.setQueryData(crmKeys.tags(workspaceSlug), tags);

  return (
    <PageContainer>
      <PageHeader
        title="CRM"
        description="Every person your chatbots, agents and team talk to, with their history in one place."
        actions={
          <>
            <ImportContactsButton />
            <CreateContactButton />
          </>
        }
      />
      <HydrateClient queryClient={queryClient}>
        <ContactsList />
      </HydrateClient>
    </PageContainer>
  );
}
