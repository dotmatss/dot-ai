"use client";

import { useState } from "react";

import { AppButton } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardDescription, AppCardFooter, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppBadge } from "@/components/ui/app-badge";
import { AppText } from "@/components/ui/app-typography";
import { ContactTagEditor } from "@/features/crm/components/contact-tag-editor";
import { useUpdateContactMutation } from "@/features/crm/mutations";
import { useContactTagsQuery } from "@/features/crm/queries";
import type { Contact } from "@/features/crm/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

export function ContactTagsCard({ contact }: { contact: Contact }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const update = useUpdateContactMutation(contact.id);
  const tagsQuery = useContactTagsQuery();
  // `null` means "follow the server copy". Holding the edit rather than
  // mirroring it into state is what lets a sibling mutation (the stage control,
  // the edit dialog) refresh this card without discarding unsaved edits - and
  // an edit that ends up matching the server hands control back.
  const [draft, setDraft] = useState<string[] | null>(null);
  const tags = draft ?? contact.tags;
  const dirty = draft !== null;

  if (!editable) {
    return (
      <AppCard>
        <AppCardHeader>
          <div>
            <AppCardTitle>Tags</AppCardTitle>
            <AppCardDescription>Labels used to segment this contact.</AppCardDescription>
          </div>
        </AppCardHeader>
        <AppCardContent>
          {contact.tags.length === 0 ? (
            <AppText size="sm" tone="muted">
              No tags yet.
            </AppText>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {contact.tags.map((tag) => (
                <li key={tag}>
                  <AppBadge size="sm">{tag}</AppBadge>
                </li>
              ))}
            </ul>
          )}
        </AppCardContent>
      </AppCard>
    );
  }

  return (
    <AppCard>
      <AppCardHeader>
        <div>
          <AppCardTitle>Tags</AppCardTitle>
          <AppCardDescription>Labels used to segment this contact. Changes are recorded in the history.</AppCardDescription>
        </div>
      </AppCardHeader>
      <AppCardContent>
        <ContactTagEditor
          value={tags}
          suggestions={(tagsQuery.data ?? []).map((item) => item.tag)}
          disabled={update.isPending}
          onChange={(next) => setDraft(sameTags(next, contact.tags) ? null : next)}
        />
      </AppCardContent>
      {dirty ? (
        <AppCardFooter className="justify-end">
          <AppButton
            variant="ghost"
            size="sm"
            disabled={update.isPending}
            onClick={() => setDraft(null)}
          >
            Discard
          </AppButton>
          <AppButton size="sm" loading={update.isPending} onClick={() => update.mutate({ tags }, { onSuccess: () => setDraft(null) })}>
            Save tags
          </AppButton>
        </AppCardFooter>
      ) : null}
    </AppCard>
  );
}
