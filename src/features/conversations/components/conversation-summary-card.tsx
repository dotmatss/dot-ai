"use client";

import { RefreshCw, Sparkles } from "lucide-react";

import { AppButton } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSpinner } from "@/components/ui/app-spinner";
import { useSummarizeConversationMutation } from "@/features/conversations/mutations";
import type { Conversation } from "@/features/conversations/types";
import { formatNumber } from "@/lib/format/number";

interface ConversationSummaryCardProps {
  conversation: Conversation;
  /** Summarizing spends model tokens, so it is a write for members and above. */
  canGenerate: boolean;
}

export function ConversationSummaryCard({ conversation, canGenerate }: ConversationSummaryCardProps) {
  const summarize = useSummarizeConversationMutation(conversation.id);
  const summary = conversation.summary;
  const hasMessages = conversation.messageCount > 0;
  const newMessages = summary ? conversation.messageCount - summary.messageCount : 0;

  return (
    <AppCard>
      <AppCardHeader>
        <div className="min-w-0">
          <AppCardTitle className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4 text-foreground-muted" />
            AI summary
          </AppCardTitle>
        </div>
        {canGenerate && hasMessages ? (
          <AppButton
            variant="ghost"
            size="sm"
            onClick={() => summarize.mutate()}
            loading={summarize.isPending}
            leadingIcon={summary ? <RefreshCw aria-hidden /> : <Sparkles aria-hidden />}
          >
            {summary ? "Regenerate" : "Generate"}
          </AppButton>
        ) : null}
      </AppCardHeader>
      <AppCardContent className="pt-3">
        {summarize.isPending ? (
          <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-foreground-muted">
            <AppSpinner size="sm" label="Summarizing" />
            Reading the conversation and writing a recap…
          </p>
        ) : summary ? (
          <div className="flex flex-col gap-2">
            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground-secondary">{summary.text}</p>
            <p className="text-caption text-foreground-subtle">
              Generated <AppRelativeTime value={summary.generatedAt} />
              {summary.generatedBy ? ` · ${summary.generatedBy}` : null}
            </p>
            {newMessages > 0 ? (
              <p className="text-caption text-foreground-muted">
                {formatNumber(newMessages)} {newMessages === 1 ? "message has" : "messages have"} arrived since this summary.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-foreground-muted">
            {!hasMessages
              ? "There is nothing to summarize yet."
              : canGenerate
                ? "Generate a recap of what the visitor asked and what was answered."
                : "No summary has been generated for this conversation."}
          </p>
        )}
      </AppCardContent>
    </AppCard>
  );
}
