"use client";

import { useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppSearchInput } from "@/components/ui/app-input";
import { AppList, AppListItem } from "@/components/ui/app-list-item";
import { AppSpinner } from "@/components/ui/app-spinner";
import { useUpdateConversationMutation } from "@/features/conversations/mutations";
import { useContactSearchQuery } from "@/features/conversations/queries";
import type { ContactSearchResult } from "@/features/conversations/types";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

function contactName(contact: ContactSearchResult): string {
  return contact.name?.trim() || contact.email || "Unnamed contact";
}

function contactDescription(contact: ContactSearchResult): string {
  return [contact.name ? contact.email : null, contact.company].filter(Boolean).join(" · ");
}

/** Contacts are stored lowercase-ish and the enum is a slug; title-case it for display. */
function stageLabel(stage: string): string {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

interface LinkContactDialogProps {
  open: boolean;
  onClose: () => void;
  conversationId: string;
}

export function LinkContactDialog({ open, onClose, conversationId }: LinkContactDialogProps) {
  const [term, setTerm] = useState("");
  const debouncedTerm = useDebouncedValue(term, 250);
  const search = useContactSearchQuery(debouncedTerm);
  const update = useUpdateConversationMutation(conversationId);
  const tooShort = debouncedTerm.trim().length < 2;

  function close() {
    setTerm("");
    onClose();
  }

  function link(contact: ContactSearchResult) {
    update.mutate({ contactId: contact.id }, { onSuccess: close });
  }

  return (
    <AppDialog
      open={open}
      onClose={close}
      title="Link a contact"
      description="Attach this conversation to a CRM contact so the history follows the person."
      size="md"
      dismissible={!update.isPending}
      footer={
        <AppButton variant="secondary" onClick={close} disabled={update.isPending}>
          Close
        </AppButton>
      }
    >
      <div className="flex flex-col gap-3">
        <AppSearchInput
          value={term}
          onValueChange={setTerm}
          placeholder="Search by name, email or company…"
          aria-label="Search contacts"
          autoFocus
        />
        {tooShort ? (
          <p className="px-1 text-xs text-foreground-muted">Type at least two characters to search.</p>
        ) : search.isPending ? (
          <p role="status" aria-live="polite" className="flex items-center gap-2 px-1 text-xs text-foreground-muted">
            <AppSpinner size="sm" label="Searching" />
            Searching contacts…
          </p>
        ) : search.isError ? (
          <AppErrorState size="sm" error={search.error} onRetry={() => void search.refetch()} />
        ) : search.data.length === 0 ? (
          <AppEmptyState
            size="sm"
            title="No matching contacts"
            description="Try another spelling, or create the contact in the CRM first."
          />
        ) : (
          <AppList>
            {search.data.map((contact) => (
              <AppListItem
                key={contact.id}
                title={contactName(contact)}
                description={contactDescription(contact) || undefined}
                onClick={() => link(contact)}
                trailing={
                  <AppBadge tone="neutral" variant="outline" size="sm">
                    {stageLabel(contact.stage)}
                  </AppBadge>
                }
              />
            ))}
          </AppList>
        )}
      </div>
    </AppDialog>
  );
}
