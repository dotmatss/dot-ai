"use client";

import type { Route } from "next";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppDetailSkeleton } from "@/components/feedback/app-loading";
import { PageHeader } from "@/components/layout/page-header";
import { AppCard, AppCardContent, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppCaption } from "@/components/ui/app-typography";
import { ConversationStatusBadge } from "@/features/conversations/components/conversation-badges";
import { ConversationMetadataPanel } from "@/features/conversations/components/conversation-metadata-panel";
import { ConversationReplyComposer } from "@/features/conversations/components/conversation-reply-composer";
import { ConversationSummaryCard } from "@/features/conversations/components/conversation-summary-card";
import { ConversationThread } from "@/features/conversations/components/conversation-thread";
import { useConversationQuery } from "@/features/conversations/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { formatNumber } from "@/lib/format/number";

export function ConversationDetailView({ conversationId }: { conversationId: string }) {
  const { membership } = useWorkspace();
  const query = useConversationQuery(conversationId);
  const editable = canEdit(membership.role);
  const inboxHref = `/w/${membership.workspace.slug}/conversations` as Route;

  if (query.isPending) return <AppDetailSkeleton />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const { conversation, messages } = query.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={conversation.title?.trim() || "Untitled conversation"}
        backHref={inboxHref}
        backLabel="All conversations"
        actions={<ConversationStatusBadge status={conversation.status} />}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-6">
        <AppCard className="min-w-0">
          <AppCardHeader>
            <AppCardTitle>Thread</AppCardTitle>
            <AppCaption>
              {formatNumber(conversation.messageCount)} {conversation.messageCount === 1 ? "message" : "messages"}
            </AppCaption>
          </AppCardHeader>
          <AppCardContent className="pt-4">
            <ConversationThread messages={messages} totalMessageCount={conversation.messageCount} />
          </AppCardContent>
          <div className="border-t border-border px-5 py-4">
            <ConversationReplyComposer conversationId={conversation.id} canReply={editable} />
          </div>
        </AppCard>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6">
          <ConversationMetadataPanel conversation={conversation} canEdit={editable} />
          <ConversationSummaryCard conversation={conversation} canGenerate={editable} />
        </div>
      </div>
    </div>
  );
}
