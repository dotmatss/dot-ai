"use client";

import { MessagesSquare } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppBadge } from "@/components/ui/app-badge";
import { AppCard, AppCardContent } from "@/components/ui/app-card";
import { AppPagination, paginationSummary } from "@/components/ui/app-pagination";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { CONTACT_CONVERSATION_CHANNEL_LABELS, CONTACT_CONVERSATION_STATUS_META } from "@/features/crm/constants";
import { parsePageParam } from "@/features/crm/filters";
import { useContactConversationsQuery } from "@/features/crm/queries";
import type { ContactConversation } from "@/features/crm/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { formatNumber } from "@/lib/format/number";
import { pageCount } from "@/types/pagination";

const PAGE_KEYS = ["page"] as const;

function ConversationItem({ conversation, href }: { conversation: ContactConversation; href: string }) {
  const status = CONTACT_CONVERSATION_STATUS_META[conversation.status];
  const channel = CONTACT_CONVERSATION_CHANNEL_LABELS[conversation.channel] ?? conversation.channel;
  const title = conversation.title?.trim() || "Untitled conversation";

  return (
    <li className="border-b border-border last:border-0">
      <Link href={href as Route} className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-surface-hover focus-ring sm:flex-row sm:items-center sm:justify-between">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">{title}</span>
          <span className="mt-0.5 block text-xs text-foreground-muted">
            {conversation.sourceName ? `${conversation.sourceName} · ` : ""}
            {channel} · {formatNumber(conversation.messageCount)} {conversation.messageCount === 1 ? "message" : "messages"} ·{" "}
            <AppRelativeTime value={conversation.lastMessageAt ?? conversation.createdAt} />
          </span>
        </span>
        <AppBadge tone={status?.tone ?? "neutral"} size="sm" dot>
          {status?.label ?? conversation.status}
        </AppBadge>
      </Link>
    </li>
  );
}

export function ContactConversationsPanel({ contactId }: { contactId: string }) {
  const { membership } = useWorkspace();
  const [params, setParams] = useSearchParamState(PAGE_KEYS);
  const page = parsePageParam({ ...params });
  const query = useContactConversationsQuery(contactId, page);

  if (query.isPending) {
    return (
      <AppCard aria-busy="true">
        <AppCardContent className="flex flex-col gap-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <div className="flex flex-1 flex-col gap-2">
                <AppSkeleton className="h-3 w-56" />
                <AppSkeleton className="h-2.5 w-40" />
              </div>
              <AppSkeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </AppCardContent>
      </AppCard>
    );
  }

  if (query.isError) {
    return (
      <AppCard>
        <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />
      </AppCard>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <AppCard aria-busy={query.isFetching || undefined}>
        {query.data.items.length === 0 ? (
          <AppEmptyState
            size="sm"
            icon={<MessagesSquare aria-hidden />}
            title="No conversations yet"
            description="Chats handled by your chatbots and agents appear here once they are linked to this contact."
          />
        ) : (
          <ul>
            {query.data.items.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                href={`/w/${membership.workspace.slug}/conversations/${conversation.id}`}
              />
            ))}
          </ul>
        )}
      </AppCard>
      <AppPagination
        page={query.data.page}
        pageCount={pageCount(query.data.total, query.data.pageSize)}
        onPageChange={(next) => setParams({ page: next > 1 ? next : undefined }, { resetPage: false })}
        summary={paginationSummary(query.data.page, query.data.pageSize, query.data.total)}
      />
    </div>
  );
}
