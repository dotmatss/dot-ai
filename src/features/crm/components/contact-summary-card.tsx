"use client";

import { Sparkles } from "lucide-react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppButton } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardDescription, AppCardFooter, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppHelpText } from "@/components/ui/app-label";
import { AppText } from "@/components/ui/app-typography";
import { useGenerateContactSummaryMutation } from "@/features/crm/mutations";
import type { Contact } from "@/features/crm/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

export function ContactSummaryCard({ contact }: { contact: Contact }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const generate = useGenerateContactSummaryMutation(contact.id);
  // The server refuses to summarize nothing, so the button says why up front
  // instead of failing after a round trip.
  const hasMaterial = contact.noteCount > 0 || contact.conversationCount > 0;

  return (
    <AppCard>
      <AppCardHeader>
        <div>
          <AppCardTitle>AI summary</AppCardTitle>
          <AppCardDescription>A short briefing written from this contact&rsquo;s notes and recent conversations.</AppCardDescription>
        </div>
      </AppCardHeader>

      <AppCardContent>
        {generate.isPending ? (
          <AppText size="sm" tone="muted" role="status" aria-live="polite">
            Reading notes and conversations…
          </AppText>
        ) : contact.aiSummary ? (
          <AppText size="sm" tone="secondary" className="whitespace-pre-wrap">
            {contact.aiSummary}
          </AppText>
        ) : (
          <AppEmptyState
            size="sm"
            icon={<Sparkles aria-hidden />}
            title="No summary yet"
            description={
              hasMaterial
                ? "Generate a briefing before your next call."
                : "Add a note or link a conversation, then generate a briefing."
            }
          />
        )}
      </AppCardContent>

      {editable ? (
        <AppCardFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <AppHelpText>
            {hasMaterial
              ? "Uses the newest notes and conversation messages."
              : "Available once this contact has a note or a conversation."}
          </AppHelpText>
          <AppButton
            variant="secondary"
            size="sm"
            leadingIcon={<Sparkles aria-hidden />}
            disabled={!hasMaterial}
            loading={generate.isPending}
            onClick={() => generate.mutate()}
          >
            {contact.aiSummary ? "Regenerate" : "Generate summary"}
          </AppButton>
        </AppCardFooter>
      ) : null}
    </AppCard>
  );
}
