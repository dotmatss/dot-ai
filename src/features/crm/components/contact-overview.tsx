"use client";

import type { ReactNode } from "react";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppCard, AppCardContent, AppCardDescription, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { ContactPropertiesEditor } from "@/features/crm/components/contact-properties-editor";
import { ContactSummaryCard } from "@/features/crm/components/contact-summary-card";
import { ContactTagsCard } from "@/features/crm/components/contact-tags-card";
import { useContactQuery } from "@/features/crm/queries";
import type { Contact } from "@/features/crm/types";
import { formatDate } from "@/lib/format/date";

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs font-medium text-foreground-muted sm:text-sm">{label}</dt>
      <dd className="min-w-0 wrap-break-word text-sm text-foreground">{children}</dd>
    </div>
  );
}

function Empty() {
  return <span className="text-foreground-subtle">Not set</span>;
}

function ContactDetailsCard({ contact }: { contact: Contact }) {
  return (
    <AppCard>
      <AppCardHeader>
        <div>
          <AppCardTitle>Details</AppCardTitle>
          <AppCardDescription>Identity and origin of this contact.</AppCardDescription>
        </div>
      </AppCardHeader>
      <AppCardContent>
        <dl className="flex flex-col gap-4">
          <DetailRow label="Email">
            {contact.email ? (
              <a href={`mailto:${contact.email}`} className="rounded-xs underline-offset-4 hover:underline focus-ring">
                {contact.email}
              </a>
            ) : (
              <Empty />
            )}
          </DetailRow>
          <DetailRow label="Phone">
            {contact.phone ? (
              <a href={`tel:${contact.phone.replace(/\s+/g, "")}`} className="rounded-xs underline-offset-4 hover:underline focus-ring">
                {contact.phone}
              </a>
            ) : (
              <Empty />
            )}
          </DetailRow>
          <DetailRow label="Company">{contact.company ?? <Empty />}</DetailRow>
          <DetailRow label="Source">{contact.source ?? <Empty />}</DetailRow>
          <DetailRow label="Last seen">
            {contact.lastSeenAt ? <AppRelativeTime value={contact.lastSeenAt} /> : <Empty />}
          </DetailRow>
          <DetailRow label="Created">{formatDate(contact.createdAt)}</DetailRow>
        </dl>
      </AppCardContent>
    </AppCard>
  );
}

export function ContactOverview({ contactId }: { contactId: string }) {
  const query = useContactQuery(contactId);

  if (query.isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-3" aria-busy="true">
        <AppSkeleton className="h-72 lg:col-span-2" />
        <AppSkeleton className="h-72" />
      </div>
    );
  }
  if (query.isError) {
    return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const contact = query.data;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <ContactDetailsCard contact={contact} />
        <ContactPropertiesEditor contact={contact} />
      </div>
      <div className="flex flex-col gap-4">
        <ContactSummaryCard contact={contact} />
        <ContactTagsCard contact={contact} />
      </div>
    </div>
  );
}
