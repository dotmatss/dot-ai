import type { Metadata } from "next";

import { ContactOverview } from "@/features/crm/components/contact-overview";

export const metadata: Metadata = { title: "Contact overview" };

export default async function ContactOverviewPage({ params }: PageProps<"/w/[workspaceSlug]/crm/[contactId]">) {
  const { contactId } = await params;
  return <ContactOverview contactId={contactId} />;
}
