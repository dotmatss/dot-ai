import { ArrowUpRight, Users } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppAvatar } from "@/components/ui/app-avatar";
import { AppBadge, type BadgeTone } from "@/components/ui/app-badge";
import { AppButtonLink } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardDescription, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { getCrmActivity } from "@/features/dashboard/server/dashboard-service";
import { formatRelativeTime } from "@/lib/format/date";

const STAGE_TONE: Record<string, BadgeTone> = { lead: "info", prospect: "purple", customer: "success", churned: "neutral" };

export async function DashboardCrmActivity({ workspaceId, workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  const crm = await getCrmActivity(workspaceId);
  const base = `/w/${workspaceSlug}/crm`;
  return (
    <AppCard>
      <AppCardHeader>
        <div>
          <AppCardTitle>CRM</AppCardTitle>
          <AppCardDescription>
            {crm.leads} leads · {crm.customers} customers · +{crm.newLast7Days} this week
          </AppCardDescription>
        </div>
        <AppButtonLink href={base as Route} variant="ghost" size="sm" trailingIcon={<ArrowUpRight aria-hidden />}>
          Contacts
        </AppButtonLink>
      </AppCardHeader>
      <AppCardContent className="pt-4">
        {crm.recentContacts.length === 0 ? (
          <AppEmptyState
            size="sm"
            icon={<Users aria-hidden />}
            title="No contacts yet"
            description="Contacts are created from chatbot conversations, workflows or manually."
          />
        ) : (
          <ul className="divide-y divide-border">
            {crm.recentContacts.map((contact) => (
              <li key={contact.id}>
                <Link href={`${base}/${contact.id}` as Route} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 text-sm hover:bg-surface-hover focus-ring">
                  <AppAvatar name={contact.name ?? contact.email ?? "Unknown"} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{contact.name ?? contact.email ?? "Unknown contact"}</span>
                    <span className="block truncate text-xs text-foreground-muted">
                      {contact.email && contact.name ? `${contact.email} · ` : ""}
                      {formatRelativeTime(contact.createdAt)}
                    </span>
                  </span>
                  <AppBadge tone={STAGE_TONE[contact.stage] ?? "neutral"} size="sm">
                    {contact.stage}
                  </AppBadge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AppCardContent>
    </AppCard>
  );
}
