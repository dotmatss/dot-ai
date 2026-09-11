"use client";

import { Building2, Mail, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { PageHeader } from "@/components/layout/page-header";
import { AppButton } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppDropdownMenu, AppDropdownMenuItem } from "@/components/ui/app-dropdown-menu";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { ContactAvatar } from "@/features/crm/components/contact-avatar";
import { ContactStageControl } from "@/features/crm/components/contact-stage-control";
import { EditContactDialog } from "@/features/crm/components/edit-contact-dialog";
import { useDeleteContactMutation } from "@/features/crm/mutations";
import { contactDisplayName } from "@/features/crm/normalize";
import { useContactQuery } from "@/features/crm/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";

export function ContactHeader({ contactId }: { contactId: string }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const query = useContactQuery(contactId);
  const remove = useDeleteContactMutation();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const base = `/w/${membership.workspace.slug}/crm` as Route;

  if (query.isPending) {
    return (
      <div className="flex items-center gap-4" aria-busy="true">
        <AppSkeleton className="size-12 rounded-full" />
        <div className="flex flex-col gap-2">
          <AppSkeleton className="h-6 w-56" />
          <AppSkeleton className="h-3 w-40" />
        </div>
      </div>
    );
  }
  if (query.isError) {
    return <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />;
  }

  const contact = query.data;
  const displayName = contactDisplayName(contact);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "CRM", href: base }, { label: displayName }]}
        leading={<ContactAvatar contact={contact} size="lg" />}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {displayName}
            <ContactStageControl contact={contact} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {contact.email ? (
              <span className="inline-flex items-center gap-1.5">
                <Mail aria-hidden className="size-3.5 text-foreground-subtle" />
                <a href={`mailto:${contact.email}`} className="rounded-xs hover:text-foreground focus-ring">
                  {contact.email}
                </a>
              </span>
            ) : null}
            {contact.company ? (
              <span className="inline-flex items-center gap-1.5">
                <Building2 aria-hidden className="size-3.5 text-foreground-subtle" />
                {contact.company}
              </span>
            ) : null}
            {contact.lastSeenAt ? (
              <span className="inline-flex items-center gap-1.5">
                Last seen <AppRelativeTime value={contact.lastSeenAt} />
              </span>
            ) : null}
          </span>
        }
        actions={
          canEdit(membership.role) ? (
            <>
              <AppButton variant="secondary" leadingIcon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>
                Edit
              </AppButton>
              {canManage(membership.role) ? (
                <AppDropdownMenu
                  label="More actions"
                  trigger={
                    <AppButton variant="secondary" size="icon" aria-label="More actions">
                      <MoreHorizontal aria-hidden />
                    </AppButton>
                  }
                >
                  <AppDropdownMenuItem destructive icon={<Trash2 aria-hidden />} onSelect={() => setConfirmDelete(true)}>
                    Delete contact
                  </AppDropdownMenuItem>
                </AppDropdownMenu>
              ) : null}
            </>
          ) : null
        }
      />

      <EditContactDialog contact={contact} open={editing} onClose={() => setEditing(false)} />

      <AppConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate(contact.id, { onSuccess: () => router.push(base) })}
        title={`Delete “${displayName}”?`}
        description="Notes, activity history and custom properties are deleted with the contact. Linked conversations are kept but lose the contact. This cannot be undone."
        confirmLabel="Delete contact"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}
