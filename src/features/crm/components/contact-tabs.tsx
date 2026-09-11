"use client";

import type { Route } from "next";

import { AppCountBadge } from "@/components/ui/app-badge";
import { AppTabNav } from "@/components/ui/app-tabs";
import { useContactQuery } from "@/features/crm/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export function ContactTabs({ contactId }: { contactId: string }) {
  const { membership } = useWorkspace();
  const query = useContactQuery(contactId);
  const base = `/w/${membership.workspace.slug}/crm/${contactId}`;
  const contact = query.data;

  return (
    <AppTabNav
      label="Contact sections"
      items={[
        { href: base as Route, label: "Overview" },
        { href: `${base}/activity` as Route, label: "Activity" },
        {
          href: `${base}/notes` as Route,
          label: "Notes",
          badge: contact ? <AppCountBadge count={contact.noteCount} /> : undefined,
        },
        {
          href: `${base}/conversations` as Route,
          label: "Conversations",
          badge: contact ? <AppCountBadge count={contact.conversationCount} /> : undefined,
        },
      ]}
    />
  );
}
