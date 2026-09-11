"use client";

import { BookOpen, FlaskConical, MoreHorizontal, Trash2 } from "lucide-react";
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
import { CreateKnowledgeBaseButton } from "@/features/knowledge/components/create-knowledge-base-dialog";
import { KnowledgeBaseStatusBadge } from "@/features/knowledge/components/knowledge-status-badge";
import { KNOWLEDGE_BASE_STATUS_META } from "@/features/knowledge/constants";
import { parseKnowledgeBaseFilters } from "@/features/knowledge/filters";
import { useDeleteKnowledgeBaseMutation } from "@/features/knowledge/mutations";
import { useKnowledgeBasesQuery } from "@/features/knowledge/queries";
import { KNOWLEDGE_BASE_STATUSES, type KnowledgeBaseSummary } from "@/features/knowledge/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { formatNumber } from "@/lib/format/number";
import { pageCount } from "@/types/pagination";
import { AppRelativeTime } from "@/components/ui/app-relative-time";

const FILTER_KEYS = ["q", "status", "page"] as const;
const COLUMNS = 6;

function KnowledgeBaseRow({
  base,
  onDelete,
}: {
  base: KnowledgeBaseSummary;
  onDelete?: (base: KnowledgeBaseSummary) => void;
}) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const href = `/w/${membership.workspace.slug}/knowledge/${base.id}` as Route;
  return (
    <AppTableRow>
      <AppTableCell>
        <Link href={href} className="group flex items-center gap-3 rounded-md focus-ring">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
            <BookOpen aria-hidden className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground group-hover:underline group-hover:underline-offset-4">
              {base.name}
            </span>
            {base.description ? (
              <span className="block max-w-md truncate text-xs text-foreground-muted">{base.description}</span>
            ) : null}
          </span>
        </Link>
      </AppTableCell>
      <AppTableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <KnowledgeBaseStatusBadge status={base.status} />
          {base.failedSourceCount > 0 && base.status !== "error" ? (
            <span className="text-caption text-foreground-muted">{base.failedSourceCount} failed</span>
          ) : null}
        </div>
      </AppTableCell>
      <AppTableCell className="tabular-nums">{formatNumber(base.sourceCount)}</AppTableCell>
      <AppTableCell className="tabular-nums">{formatNumber(base.chunkCount)}</AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        <AppRelativeTime value={base.updatedAt} />
      </AppTableCell>
      <AppTableCell className="w-12 text-right">
        <AppDropdownMenu
          label={`Actions for ${base.name}`}
          trigger={
            <AppButton variant="ghost" size="icon-sm" aria-label={`Actions for ${base.name}`}>
              <MoreHorizontal aria-hidden />
            </AppButton>
          }
        >
          <AppDropdownMenuItem icon={<BookOpen aria-hidden />} onSelect={() => router.push(href)}>
            Open
          </AppDropdownMenuItem>
          <AppDropdownMenuItem icon={<FlaskConical aria-hidden />} onSelect={() => router.push(`${href}/test` as Route)}>
            Test retrieval
          </AppDropdownMenuItem>
          {onDelete ? (
            <AppDropdownMenuItem destructive icon={<Trash2 aria-hidden />} onSelect={() => onDelete(base)}>
              Delete
            </AppDropdownMenuItem>
          ) : null}
        </AppDropdownMenu>
      </AppTableCell>
    </AppTableRow>
  );
}

export function KnowledgeBasesList() {
  const { membership } = useWorkspace();
  const [params, setParams] = useSearchParamState(FILTER_KEYS);
  const [search, setSearch] = useState(params.q ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [pendingDelete, setPendingDelete] = useState<KnowledgeBaseSummary | null>(null);
  const deleteMutation = useDeleteKnowledgeBaseMutation();

  // Persist the debounced search term in the URL so it survives reloads.
  useEffect(() => {
    const current = params.q ?? "";
    if (debouncedSearch !== current) setParams({ q: debouncedSearch || undefined });
  }, [debouncedSearch, params.q, setParams]);

  const filters = useMemo(
    () => parseKnowledgeBaseFilters({ ...params, q: debouncedSearch || undefined }),
    [params, debouncedSearch],
  );
  const query = useKnowledgeBasesQuery(filters);
  const hasFilters = Boolean(filters.q || filters.status);

  function clearFilters() {
    setSearch("");
    setParams({ q: undefined, status: undefined });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <AppSearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search knowledge bases…"
            aria-label="Search knowledge bases"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
          <AppChip selected={!filters.status} onClick={() => setParams({ status: undefined })}>
            All
          </AppChip>
          {KNOWLEDGE_BASE_STATUSES.map((status) => (
            <AppChip
              key={status}
              selected={filters.status === status}
              onClick={() => setParams({ status: filters.status === status ? undefined : status })}
            >
              {KNOWLEDGE_BASE_STATUS_META[status].label}
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
                  <AppTableHead>Knowledge base</AppTableHead>
                  <AppTableHead>Status</AppTableHead>
                  <AppTableHead>Sources</AppTableHead>
                  <AppTableHead>Passages</AppTableHead>
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
                        title="No knowledge bases match your filters"
                        description="Try a different search term or clear the filters."
                        action={
                          <AppButton variant="secondary" size="sm" onClick={clearFilters}>
                            Clear filters
                          </AppButton>
                        }
                      />
                    ) : (
                      <AppEmptyState
                        icon={<BookOpen aria-hidden />}
                        title="Create your first knowledge base"
                        description="A knowledge base holds the text, pages and files your chatbots and agents answer from, and cites in their replies."
                        action={<CreateKnowledgeBaseButton />}
                      />
                    )}
                  </AppTableMessageRow>
                ) : (
                  query.data.items.map((base) => (
                    <KnowledgeBaseRow
                      key={base.id}
                      base={base}
                      onDelete={canManage(membership.role) ? setPendingDelete : undefined}
                    />
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
        description={`Its ${pendingDelete?.sourceCount ?? 0} source${pendingDelete?.sourceCount === 1 ? "" : "s"} and every indexed passage are deleted, and any chatbot or agent using it loses that grounding. This cannot be undone.`}
        confirmLabel="Delete knowledge base"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
