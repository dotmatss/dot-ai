"use client";

import { MessagesSquare } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppAvatar } from "@/components/ui/app-avatar";
import { AppButton, AppButtonLink } from "@/components/ui/app-button";
import { AppChip } from "@/components/ui/app-chip";
import { AppSearchInput } from "@/components/ui/app-input";
import { AppPagination, paginationSummary } from "@/components/ui/app-pagination";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSelect } from "@/components/ui/app-select";
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
import { ConversationChannelBadge, ConversationStatusBadge } from "@/features/conversations/components/conversation-badges";
import { CONVERSATION_CHANNEL_META, CONVERSATION_STATUS_META } from "@/features/conversations/constants";
import {
  CONVERSATION_FILTER_KEYS,
  hasActiveConversationFilters,
  parseConversationFilters,
  type ConversationFilterKey,
} from "@/features/conversations/filters";
import { useConversationsQuery } from "@/features/conversations/queries";
import {
  CONVERSATION_CHANNELS,
  CONVERSATION_STATUSES,
  type ConversationListFilters,
  type ConversationListItem,
} from "@/features/conversations/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format/number";
import { pageCount } from "@/types/pagination";

const COLUMNS = 7;

export interface ConversationsTableProps {
  /**
   * Filters pinned by the host surface (for example `{ chatbotId }` when the
   * inbox is embedded in a chatbot page). A pinned filter always wins over the
   * URL and its control is hidden, so the embedded view cannot be widened out
   * of the context it was opened in.
   */
  fixed?: Partial<ConversationListFilters>;
  /** Replaces the default call to action when the workspace has no conversations. */
  emptyAction?: ReactNode;
  className?: string;
}

const CONTEXT_FILTER_LABELS = { chatbotId: "Chatbot", agentId: "Agent", contactId: "Contact" } as const;

function conversationTitle(conversation: ConversationListItem): string {
  return conversation.title?.trim() || "Untitled conversation";
}

function ConversationRow({ conversation, workspaceSlug }: { conversation: ConversationListItem; workspaceSlug: string }) {
  const href = `/w/${workspaceSlug}/conversations/${conversation.id}` as Route;
  const contactLabel = conversation.contact?.name?.trim() || conversation.contact?.email || null;

  return (
    <AppTableRow>
      <AppTableCell className="max-w-xs">
        <Link href={href} className="group block rounded-md focus-ring">
          <span className="block truncate font-medium text-foreground group-hover:underline group-hover:underline-offset-4">
            {conversationTitle(conversation)}
          </span>
          <span className="block truncate text-xs text-foreground-muted">
            {conversation.source
              ? `${conversation.source.name} · ${conversation.source.type === "chatbot" ? "Chatbot" : "Agent"}`
              : "No linked chatbot or agent"}
          </span>
        </Link>
      </AppTableCell>
      <AppTableCell>
        <ConversationChannelBadge channel={conversation.channel} size="sm" />
      </AppTableCell>
      <AppTableCell className="max-w-40">
        {conversation.contact ? (
          <Link
            href={`/w/${workspaceSlug}/crm/${conversation.contact.id}` as Route}
            className="block truncate rounded-xs underline-offset-4 hover:underline focus-ring"
          >
            {contactLabel ?? "Unnamed contact"}
          </Link>
        ) : (
          <span className="text-foreground-subtle">Not linked</span>
        )}
      </AppTableCell>
      <AppTableCell className="tabular-nums">{formatNumber(conversation.messageCount)}</AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        {conversation.lastMessageAt ? <AppRelativeTime value={conversation.lastMessageAt} /> : <span>No messages</span>}
      </AppTableCell>
      <AppTableCell>
        {conversation.assignee ? (
          <span className="flex items-center gap-2">
            <AppAvatar name={conversation.assignee.name} src={conversation.assignee.avatarUrl} size="xs" />
            <span className="max-w-28 truncate">{conversation.assignee.name}</span>
          </span>
        ) : (
          <span className="text-foreground-subtle">Unassigned</span>
        )}
      </AppTableCell>
      <AppTableCell>
        <ConversationStatusBadge status={conversation.status} size="sm" />
      </AppTableCell>
    </AppTableRow>
  );
}

/**
 * The conversations inbox as a self-contained client component so other
 * features can embed it with their own pinned filters.
 */
export function ConversationsTable({ fixed, emptyAction, className }: ConversationsTableProps) {
  const { membership } = useWorkspace();
  const workspaceSlug = membership.workspace.slug;
  const [params, setParams] = useSearchParamState(CONVERSATION_FILTER_KEYS);
  const [search, setSearch] = useState(params.q ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);

  // Persist the debounced search term in the URL so it survives reloads.
  useEffect(() => {
    const current = params.q ?? "";
    if (debouncedSearch !== current) setParams({ q: debouncedSearch || undefined });
  }, [debouncedSearch, params.q, setParams]);

  const filters = useMemo(
    () => parseConversationFilters({ ...params, q: debouncedSearch || undefined }, fixed),
    [params, debouncedSearch, fixed],
  );
  const query = useConversationsQuery(filters);
  const items = query.data?.items;
  const hasFilters = hasActiveConversationFilters(filters, fixed);

  /** A deep link carries ids, not names; the loaded rows supply the labels. */
  function labelFor(key: keyof typeof CONTEXT_FILTER_LABELS, id: string): string {
    if (key === "contactId") {
      const match = items?.find((item) => item.contact?.id === id);
      return match?.contact?.name?.trim() || match?.contact?.email || "selected";
    }
    const type = key === "chatbotId" ? "chatbot" : "agent";
    const match = items?.find((item) => item.source !== null && item.source.id === id && item.source.type === type);
    return match?.source?.name ?? "selected";
  }

  const contextChips = (["chatbotId", "agentId", "contactId"] as const).flatMap((key) => {
    const value = fixed?.[key] === undefined ? filters[key] : undefined;
    return value ? [{ key, label: `${CONTEXT_FILTER_LABELS[key]}: ${labelFor(key, value)}` }] : [];
  });

  const assigneeName =
    filters.assignedTo && filters.assignedTo !== "me"
      ? items?.find((item) => item.assignee?.id === filters.assignedTo)?.assignee?.name
      : undefined;

  function clearFilter(key: ConversationFilterKey) {
    const patch: Partial<Record<ConversationFilterKey, undefined>> = {};
    patch[key] = undefined;
    setParams(patch);
  }

  function clearFilters() {
    setSearch("");
    setParams({ q: undefined, status: undefined, channel: undefined, chatbotId: undefined, agentId: undefined, contactId: undefined, assignedTo: undefined });
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="w-full sm:max-w-xs">
            <AppSearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search titles and messages…"
              aria-label="Search conversations"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {fixed?.status === undefined ? (
              <div className="w-36">
                <AppSelect
                  size="sm"
                  aria-label="Filter by status"
                  value={filters.status ?? ""}
                  onChange={(event) => setParams({ status: event.target.value || undefined })}
                  options={[
                    { value: "", label: "Any status" },
                    ...CONVERSATION_STATUSES.map((status) => ({ value: status, label: CONVERSATION_STATUS_META[status].label })),
                  ]}
                />
              </div>
            ) : null}
            {fixed?.channel === undefined ? (
              <div className="w-36">
                <AppSelect
                  size="sm"
                  aria-label="Filter by channel"
                  value={filters.channel ?? ""}
                  onChange={(event) => setParams({ channel: event.target.value || undefined })}
                  options={[
                    { value: "", label: "Any channel" },
                    ...CONVERSATION_CHANNELS.map((channel) => ({ value: channel, label: CONVERSATION_CHANNEL_META[channel].label })),
                  ]}
                />
              </div>
            ) : null}
            {fixed?.assignedTo === undefined ? (
              <div className="w-40">
                <AppSelect
                  size="sm"
                  aria-label="Filter by assignee"
                  value={filters.assignedTo ?? ""}
                  onChange={(event) => setParams({ assignedTo: event.target.value || undefined })}
                  options={[
                    { value: "", label: "Anyone" },
                    { value: "me", label: "Assigned to me" },
                    ...(filters.assignedTo && filters.assignedTo !== "me"
                      ? [{ value: filters.assignedTo, label: assigneeName ?? "Selected teammate" }]
                      : []),
                  ]}
                />
              </div>
            ) : null}
            {hasFilters ? (
              <AppButton variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </AppButton>
            ) : null}
          </div>
        </div>
        {contextChips.length > 0 ? (
          <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
            {contextChips.map((chip) => (
              <li key={chip.key}>
                <AppChip onRemove={() => clearFilter(chip.key)} removeLabel={`Remove filter ${chip.label}`}>
                  {chip.label}
                </AppChip>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {query.isPending ? (
        <AppListSkeleton rows={6} />
      ) : query.isError ? (
        <AppTableContainer>
          <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />
        </AppTableContainer>
      ) : (
        <>
          <AppTableContainer aria-busy={query.isFetching || undefined}>
            <AppTable>
              <AppTableHeader>
                <AppTableRow>
                  <AppTableHead>Conversation</AppTableHead>
                  <AppTableHead>Channel</AppTableHead>
                  <AppTableHead>Contact</AppTableHead>
                  <AppTableHead>Messages</AppTableHead>
                  <AppTableHead>Last message</AppTableHead>
                  <AppTableHead>Assignee</AppTableHead>
                  <AppTableHead>Status</AppTableHead>
                </AppTableRow>
              </AppTableHeader>
              <AppTableBody>
                {query.data.items.length === 0 ? (
                  <AppTableMessageRow colSpan={COLUMNS}>
                    {hasFilters ? (
                      <AppEmptyState
                        size="sm"
                        title="No conversations match your filters"
                        description="Try a different search term, or clear the filters to see the whole inbox."
                        action={
                          <AppButton variant="secondary" size="sm" onClick={clearFilters}>
                            Clear filters
                          </AppButton>
                        }
                      />
                    ) : (
                      <AppEmptyState
                        icon={<MessagesSquare aria-hidden />}
                        title="No conversations yet"
                        description="Conversations appear here as soon as a chatbot, agent or the API starts one. Test a chatbot in its playground to see the flow end to end."
                        action={
                          emptyAction ?? (
                            <AppButtonLink href={`/w/${workspaceSlug}/chatbots` as Route} variant="secondary" size="sm">
                              Go to chatbots
                            </AppButtonLink>
                          )
                        }
                      />
                    )}
                  </AppTableMessageRow>
                ) : (
                  query.data.items.map((conversation) => (
                    <ConversationRow key={conversation.id} conversation={conversation} workspaceSlug={workspaceSlug} />
                  ))
                )}
              </AppTableBody>
            </AppTable>
          </AppTableContainer>
          <AppPagination
            page={query.data.page}
            pageCount={pageCount(query.data.total, query.data.pageSize)}
            onPageChange={(page) => setParams({ page: page > 1 ? page : undefined }, { resetPage: false })}
            summary={paginationSummary(query.data.page, query.data.pageSize, query.data.total)}
          />
        </>
      )}
    </div>
  );
}
