"use client";

import { BookOpenCheck, BookX, MessagesSquare } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppBadge } from "@/components/ui/app-badge";
import { AppPagination, paginationSummary } from "@/components/ui/app-pagination";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableMessageRow,
  AppTableRow,
} from "@/components/ui/app-table";
import { AppTooltip } from "@/components/ui/app-tooltip";
import { OUTCOME_META } from "@/features/intelligence/constants";
import { useTopicConversationsQuery } from "@/features/intelligence/queries";
import type { TopicConversation } from "@/features/intelligence/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { pageCount } from "@/types/pagination";

const COLUMNS = 5;

function GroundedCell({ conversation }: { conversation: TopicConversation }) {
  if (conversation.grounded) {
    return (
      <AppTooltip content={`${conversation.sourceCount} knowledge citation${conversation.sourceCount === 1 ? "" : "s"} in this thread.`}>
        <span tabIndex={0} className="inline-flex rounded-full focus-ring" aria-label="Answered from knowledge">
          <BookOpenCheck className="size-4 text-success" aria-hidden />
        </span>
      </AppTooltip>
    );
  }
  return (
    <AppTooltip content="No reply in this thread cited a knowledge source. The model answered from its own weights.">
      <span tabIndex={0} className="inline-flex rounded-full focus-ring" aria-label="Not answered from knowledge">
        <BookX className="size-4 text-danger" aria-hidden />
      </span>
    </AppTooltip>
  );
}

function ConversationRow({ conversation }: { conversation: TopicConversation }) {
  const { membership } = useWorkspace();
  const href = `/w/${membership.workspace.slug}/conversations/${conversation.conversationId}` as Route;
  const outcome = OUTCOME_META[conversation.outcome];

  return (
    <AppTableRow>
      <AppTableCell>
        <Link href={href} className="group block rounded-md focus-ring">
          <span className="block max-w-xl truncate font-medium text-foreground group-hover:underline group-hover:underline-offset-4">
            {conversation.title ?? conversation.question}
          </span>
          {conversation.title ? (
            <span className="mt-0.5 block max-w-xl truncate text-xs text-foreground-muted">{conversation.question}</span>
          ) : null}
        </Link>
      </AppTableCell>
      <AppTableCell>
        <AppTooltip content={outcome.description}>
          <span tabIndex={0} className="inline-flex rounded-full focus-ring">
            <AppBadge tone={outcome.tone} size="sm">
              {outcome.label}
            </AppBadge>
          </span>
        </AppTooltip>
      </AppTableCell>
      <AppTableCell>
        <GroundedCell conversation={conversation} />
      </AppTableCell>
      <AppTableCell className="tabular-nums text-foreground-secondary">{conversation.messageCount}</AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        {conversation.lastMessageAt ? (
          <AppRelativeTime value={conversation.lastMessageAt} />
        ) : (
          <AppRelativeTime value={conversation.createdAt} />
        )}
      </AppTableCell>
    </AppTableRow>
  );
}

export function TopicConversations({ topicId, page, onPageChange }: { topicId: string; page: number; onPageChange: (page: number) => void }) {
  const query = useTopicConversationsQuery(topicId, page);

  if (query.isPending) return <AppListSkeleton rows={5} />;
  if (query.isError) {
    return (
      <AppTableContainer>
        <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />
      </AppTableContainer>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <AppTableContainer aria-busy={query.isFetching || undefined}>
        <AppTable>
          <AppTableHeader>
            <AppTableRow>
              <AppTableHead>Conversation</AppTableHead>
              <AppTableHead>Outcome</AppTableHead>
              <AppTableHead>Knowledge</AppTableHead>
              <AppTableHead>Messages</AppTableHead>
              <AppTableHead>Last message</AppTableHead>
            </AppTableRow>
          </AppTableHeader>
          <AppTableBody>
            {query.data.items.length === 0 ? (
              <AppTableMessageRow colSpan={COLUMNS}>
                <AppEmptyState
                  size="sm"
                  icon={<MessagesSquare aria-hidden />}
                  title="No conversations in this topic"
                  description="They may have been deleted since the last analysis."
                />
              </AppTableMessageRow>
            ) : (
              query.data.items.map((conversation) => (
                <ConversationRow key={conversation.id} conversation={conversation} />
              ))
            )}
          </AppTableBody>
        </AppTable>
      </AppTableContainer>
      <AppPagination
        page={query.data.page}
        pageCount={pageCount(query.data.total, query.data.pageSize)}
        onPageChange={onPageChange}
        summary={paginationSummary(query.data.page, query.data.pageSize, query.data.total)}
      />
    </div>
  );
}
