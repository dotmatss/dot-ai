"use client";

import { Bot, FlaskConical, MoreHorizontal, Trash2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppButton } from "@/components/ui/app-button";
import { AppChip } from "@/components/ui/app-chip";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppDropdownMenu, AppDropdownMenuItem } from "@/components/ui/app-dropdown-menu";
import { AppSearchInput } from "@/components/ui/app-input";
import { AppPagination, paginationSummary } from "@/components/ui/app-pagination";
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
import { ChatbotStatusBadge } from "@/features/chatbots/components/chatbot-status-badge";
import { CreateChatbotButton } from "@/features/chatbots/components/create-chatbot-dialog";
import { CHATBOT_STATUS_META } from "@/features/chatbots/constants";
import { parseChatbotFilters } from "@/features/chatbots/filters";
import { useDeleteChatbotMutation } from "@/features/chatbots/mutations";
import { useChatbotsQuery } from "@/features/chatbots/queries";
import { CHATBOT_STATUSES, type ChatbotSummary } from "@/features/chatbots/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { pageCount } from "@/types/pagination";

const FILTER_KEYS = ["q", "status", "page"] as const;
const COLUMNS = 6;

function ChatbotRow({ chatbot, onDelete }: { chatbot: ChatbotSummary; onDelete?: (chatbot: ChatbotSummary) => void }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const href = `/w/${membership.workspace.slug}/chatbots/${chatbot.id}` as Route;
  return (
    <AppTableRow>
      <AppTableCell>
        <Link href={href} className="group flex items-center gap-3 rounded-md focus-ring">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
            <Bot aria-hidden className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground group-hover:underline group-hover:underline-offset-4">{chatbot.name}</span>
            {chatbot.description ? <span className="block max-w-md truncate text-xs text-foreground-muted">{chatbot.description}</span> : null}
          </span>
        </Link>
      </AppTableCell>
      <AppTableCell>
        <ChatbotStatusBadge status={chatbot.status} />
      </AppTableCell>
      <AppTableCell className="tabular-nums">{chatbot.conversationCount}</AppTableCell>
      <AppTableCell className="tabular-nums">{chatbot.collectionCount}</AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        <AppRelativeTime value={chatbot.updatedAt} />
      </AppTableCell>
      <AppTableCell className="w-12 text-right">
        <AppDropdownMenu
          label={`Actions for ${chatbot.name}`}
          trigger={
            <AppButton variant="ghost" size="icon-sm" aria-label={`Actions for ${chatbot.name}`}>
              <MoreHorizontal aria-hidden />
            </AppButton>
          }
        >
          <AppDropdownMenuItem icon={<Bot aria-hidden />} onSelect={() => router.push(href)}>
            Open
          </AppDropdownMenuItem>
          <AppDropdownMenuItem icon={<FlaskConical aria-hidden />} onSelect={() => router.push(`${href}/playground` as Route)}>
            Test in playground
          </AppDropdownMenuItem>
          {onDelete ? (
            <AppDropdownMenuItem destructive icon={<Trash2 aria-hidden />} onSelect={() => onDelete(chatbot)}>
              Delete
            </AppDropdownMenuItem>
          ) : null}
        </AppDropdownMenu>
      </AppTableCell>
    </AppTableRow>
  );
}

export function ChatbotsList() {
  const { membership } = useWorkspace();
  const [params, setParams] = useSearchParamState(FILTER_KEYS);
  const [search, setSearch] = useState(params.q ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [pendingDelete, setPendingDelete] = useState<ChatbotSummary | null>(null);
  const deleteMutation = useDeleteChatbotMutation();

  // Persist the debounced search term in the URL so it survives reloads.
  useEffect(() => {
    const current = params.q ?? "";
    if (debouncedSearch !== current) setParams({ q: debouncedSearch || undefined });
  }, [debouncedSearch, params.q, setParams]);

  const filters = useMemo(() => parseChatbotFilters({ ...params, q: debouncedSearch || undefined }), [params, debouncedSearch]);
  const query = useChatbotsQuery(filters);
  const hasFilters = Boolean(filters.q || filters.status);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <AppSearchInput value={search} onValueChange={setSearch} placeholder="Search chatbots…" aria-label="Search chatbots" />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
          <AppChip selected={!filters.status} onClick={() => setParams({ status: undefined })}>
            All
          </AppChip>
          {CHATBOT_STATUSES.map((status) => (
            <AppChip key={status} selected={filters.status === status} onClick={() => setParams({ status: filters.status === status ? undefined : status })}>
              {CHATBOT_STATUS_META[status].label}
            </AppChip>
          ))}
        </div>
      </div>

      {query.isPending ? (
        <AppListSkeleton rows={5} />
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
                  <AppTableHead>Chatbot</AppTableHead>
                  <AppTableHead>Status</AppTableHead>
                  <AppTableHead>Conversations</AppTableHead>
                  <AppTableHead>Knowledge</AppTableHead>
                  <AppTableHead>Updated</AppTableHead>
                  <AppTableHead>
                    <span className="sr-only">Actions</span>
                  </AppTableHead>
                </AppTableRow>
              </AppTableHeader>
              <AppTableBody>
                {query.data.items.length === 0 ? (
                  <AppTableMessageRow colSpan={COLUMNS}>
                    {hasFilters ? (
                      <AppEmptyState
                        size="sm"
                        title="No chatbots match your filters"
                        description="Try a different search term or clear the filters."
                        action={
                          <AppButton
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setSearch("");
                              setParams({ q: undefined, status: undefined });
                            }}
                          >
                            Clear filters
                          </AppButton>
                        }
                      />
                    ) : (
                      <AppEmptyState
                        icon={<Bot aria-hidden />}
                        title="Create your first chatbot"
                        description="Chatbots answer visitor questions using your instructions and collections, and can be embedded on any website."
                        action={<CreateChatbotButton />}
                      />
                    )}
                  </AppTableMessageRow>
                ) : (
                  query.data.items.map((chatbot) => (
                    <ChatbotRow key={chatbot.id} chatbot={chatbot} onDelete={canManage(membership.role) ? setPendingDelete : undefined} />
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

      <AppConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteMutation.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
        }}
        title={`Delete “${pendingDelete?.name ?? ""}”?`}
        description="Conversations linked to this chatbot are kept, but the embed stops working immediately. This cannot be undone."
        confirmLabel="Delete chatbot"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
