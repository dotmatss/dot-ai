import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { ContactHeader } from "@/features/crm/components/contact-header";
import { ContactTabs } from "@/features/crm/components/contact-tabs";
import { crmKeys } from "@/features/crm/queries";
import { findContactById } from "@/features/crm/server/contact-repository";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export default async function ContactLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/crm/[contactId]">) {
  const { workspaceSlug, contactId } = await params;
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const contact = await findContactById(membership.workspace.id, contactId);
  if (!contact) notFound();

  const queryClient = makeQueryClient();
  queryClient.setQueryData(crmKeys.detail(workspaceSlug, contactId), contact);

  return (
    <HydrateClient queryClient={queryClient}>
      <PageContainer>
        <ContactHeader contactId={contactId} />
        <ContactTabs contactId={contactId} />
        <div>{children}</div>
      </PageContainer>
    </HydrateClient>
  );
}
