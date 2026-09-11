"use client";

import {
  ArrowRightLeft,
  History,
  MessagesSquare,
  Pencil,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
  Tag,
  UserPlus,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppCard, AppCardContent } from "@/components/ui/app-card";
import { AppPagination, paginationSummary } from "@/components/ui/app-pagination";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { parsePageParam } from "@/features/crm/filters";
import { useContactActivitiesQuery } from "@/features/crm/queries";
import type { ContactTimelineEntry } from "@/features/crm/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { pageCount } from "@/types/pagination";

const PAGE_KEYS = ["page"] as const;

/** Icon per event type; unknown types (written by integrations) fall back. */
function entryIcon(entry: ContactTimelineEntry): ReactNode {
  if (entry.kind === "note") return <StickyNote aria-hidden />;
  if (entry.kind === "conversation") return <MessagesSquare aria-hidden />;
  switch (entry.type) {
    case "created":
      return <UserPlus aria-hidden />;
    case "stage_changed":
      return <ArrowRightLeft aria-hidden />;
    case "tags_changed":
      return <Tag aria-hidden />;
    case "properties_changed":
      return <SlidersHorizontal aria-hidden />;
    case "summary_generated":
      return <Sparkles aria-hidden />;
    case "updated":
      return <Pencil aria-hidden />;
    default:
      return <History aria-hidden />;
  }
}

function TimelineEntry({ entry, conversationHref }: { entry: ContactTimelineEntry; conversationHref: string | null }) {
  const meta: string[] = [];
  if (entry.actorName) meta.push(entry.actorName);
  if (entry.kind === "conversation") {
    const channel = typeof entry.metadata.channel === "string" ? entry.metadata.channel : null;
    const messages = typeof entry.metadata.messageCount === "number" ? entry.metadata.messageCount : null;
    if (channel) meta.push(channel);
    if (messages !== null) meta.push(`${messages} ${messages === 1 ? "message" : "messages"}`);
  }

  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {/* Connector between markers; decorative, so hidden from the timeline's semantics. */}
      <span aria-hidden className="absolute bottom-0 left-4 top-9 w-px bg-border" />
      <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-foreground-muted [&_svg]:size-4">
        {entryIcon(entry)}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-sm font-medium text-foreground">
          {conversationHref ? (
            <Link href={conversationHref as Route} className="rounded-xs underline-offset-4 hover:underline focus-ring">
              {entry.title}
            </Link>
          ) : (
            entry.title
          )}
        </p>
        {entry.body ? (
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground-secondary">{entry.body}</p>
        ) : null}
        <p className="mt-1 text-xs text-foreground-muted">
          {meta.length > 0 ? <span>{meta.join(" · ")} · </span> : null}
          <AppRelativeTime value={entry.createdAt} />
        </p>
      </div>
    </li>
  );
}

export function ContactActivityPanel({ contactId }: { contactId: string }) {
  const { membership } = useWorkspace();
  const [params, setParams] = useSearchParamState(PAGE_KEYS);
  const page = parsePageParam({ ...params });
  const query = useContactActivitiesQuery(contactId, page);

  if (query.isPending) {
    return (
      <AppCard aria-busy="true">
        <AppCardContent className="flex flex-col gap-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex gap-3">
              <AppSkeleton className="size-8 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <AppSkeleton className="h-3 w-56" />
                <AppSkeleton className="h-2.5 w-28" />
              </div>
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

  const { items, total, pageSize } = query.data;

  return (
    <div className="flex flex-col gap-4">
      <AppCard aria-busy={query.isFetching || undefined}>
        <AppCardContent>
          {items.length === 0 ? (
            <AppEmptyState
              size="sm"
              icon={<History aria-hidden />}
              title="Nothing has happened yet"
              description="Stage changes, tag and property edits, notes and conversations all appear here."
            />
          ) : (
            <ol className="flex flex-col">
              {items.map((entry) => (
                <TimelineEntry
                  key={entry.id}
                  entry={entry}
                  conversationHref={
                    entry.kind === "conversation" && entry.refId
                      ? `/w/${membership.workspace.slug}/conversations/${entry.refId}`
                      : null
                  }
                />
              ))}
            </ol>
          )}
        </AppCardContent>
      </AppCard>
      <AppPagination
        page={query.data.page}
        pageCount={pageCount(total, pageSize)}
        onPageChange={(next) => setParams({ page: next > 1 ? next : undefined }, { resetPage: false })}
        summary={paginationSummary(query.data.page, pageSize, total)}
      />
    </div>
  );
}
