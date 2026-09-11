"use client";

import { ExternalLink, FileStack, FolderInput, Inbox, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppDropdownMenu, AppDropdownMenuItem } from "@/components/ui/app-dropdown-menu";
import { AppSearchInput } from "@/components/ui/app-input";
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
import { AddSourceButton } from "@/features/knowledge/components/add-source-dialog";
import { KnowledgeSourceStatusBadge } from "@/features/knowledge/components/knowledge-status-badge";
import { MoveSourceDialog } from "@/features/knowledge/components/move-source-dialog";
import { SourceTypeIcon } from "@/features/knowledge/components/source-type-icon";
import { KNOWLEDGE_SOURCES_PAGE_SIZE } from "@/features/knowledge/constants";
import { parseKnowledgeSourceFilters } from "@/features/knowledge/filters";
import {
  useDeleteSourceMutation,
  useReprocessSourceMutation,
} from "@/features/knowledge/mutations";
import { useKnowledgeSourcesQuery } from "@/features/knowledge/queries";
import { isSourceInFlight, type KnowledgeScope, type KnowledgeSource } from "@/features/knowledge/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { formatNumber } from "@/lib/format/number";
import { pageCount } from "@/types/pagination";

const FILTER_KEYS = ["q", "page"] as const;

/** The "not in any collection" cell, which is a state rather than a missing value. */
function UnorganizedBadge() {
  return (
    <AppBadge tone="neutral" size="sm" title="Not in a collection, so no agent can retrieve from it.">
      Unorganized
    </AppBadge>
  );
}

function SourceRow({
  source,
  showCollection,
  workspaceSlug,
  onReprocess,
  onMove,
  onRemove,
  busy,
}: {
  source: KnowledgeSource;
  showCollection: boolean;
  workspaceSlug: string;
  onReprocess?: (source: KnowledgeSource) => void;
  onMove?: (source: KnowledgeSource) => void;
  onRemove?: (source: KnowledgeSource) => void;
  busy: boolean;
}) {
  const inFlight = isSourceInFlight(source.status);
  const hasActions = Boolean(onReprocess || onMove || onRemove);
  return (
    <AppTableRow>
      <AppTableCell>
        <div className="flex items-start gap-3">
          <SourceTypeIcon type={source.type} />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{source.name}</p>
            {source.uri ? (
              <a
                href={source.uri}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex max-w-xs items-center gap-1 truncate text-xs text-foreground-muted hover:text-foreground focus-ring rounded-xs"
              >
                <span className="truncate">{source.uri}</span>
                <ExternalLink aria-hidden className="size-3 shrink-0" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <p className="max-w-xs truncate text-xs text-foreground-muted">
                {source.contentPreview ?? `${formatNumber(source.characterCount)} characters`}
              </p>
            )}
          </div>
        </div>
      </AppTableCell>
      {showCollection ? (
        <AppTableCell>
          {source.collectionId && source.collectionName ? (
            <Link
              href={`/w/${workspaceSlug}/knowledge/collections/${source.collectionId}` as Route}
              className="truncate text-foreground-secondary underline-offset-4 hover:text-foreground hover:underline focus-ring rounded-xs"
            >
              {source.collectionName}
            </Link>
          ) : (
            <UnorganizedBadge />
          )}
        </AppTableCell>
      ) : null}
      <AppTableCell>
        <div className="flex flex-col items-start gap-1">
          <KnowledgeSourceStatusBadge status={source.status} />
          {source.status === "failed" && source.error ? (
            <p className="max-w-xs text-xs text-danger">{source.error}</p>
          ) : null}
        </div>
      </AppTableCell>
      <AppTableCell className="tabular-nums">{formatNumber(source.chunkCount)}</AppTableCell>
      <AppTableCell className="tabular-nums">{formatNumber(source.tokenCount)}</AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        <AppRelativeTime value={source.updatedAt} />
      </AppTableCell>
      <AppTableCell className="w-12 text-right">
        {hasActions ? (
          <AppDropdownMenu
            label={`Actions for ${source.name}`}
            trigger={
              <AppButton variant="ghost" size="icon-sm" aria-label={`Actions for ${source.name}`} disabled={busy}>
                <MoreHorizontal aria-hidden />
              </AppButton>
            }
          >
            {onMove ? (
              <AppDropdownMenuItem icon={<FolderInput aria-hidden />} onSelect={() => onMove(source)}>
                Move to collection
              </AppDropdownMenuItem>
            ) : null}
            {onReprocess ? (
              <AppDropdownMenuItem
                icon={<RefreshCw aria-hidden />}
                disabled={inFlight}
                onSelect={() => onReprocess(source)}
              >
                Reprocess
              </AppDropdownMenuItem>
            ) : null}
            {onRemove ? (
              <AppDropdownMenuItem destructive icon={<Trash2 aria-hidden />} onSelect={() => onRemove(source)}>
                Remove
              </AppDropdownMenuItem>
            ) : null}
          </AppDropdownMenu>
        ) : null}
      </AppTableCell>
    </AppTableRow>
  );
}

/** Copy that depends on which documents the panel is showing. */
function emptyStateFor(scope: KnowledgeScope, collectionId: string | null) {
  if (scope.kind === "unorganized") {
    return {
      icon: <Inbox aria-hidden />,
      title: "Nothing waiting to be filed",
      description:
        "Documents added without a collection land here. Everything you have added is already in a collection.",
      action: <AddSourceButton collectionId={collectionId} />,
    };
  }
  return {
    icon: <FileStack aria-hidden />,
    title: "No sources yet",
    description:
      "Paste text, import a public page or upload a text file. Nothing can be retrieved until at least one source is indexed.",
    action: <AddSourceButton collectionId={collectionId} />,
  };
}

/**
 * The document table, used for a single collection, for Unorganized and for
 * All Knowledge. The scope decides which documents are listed and whether the
 * collection column is worth a column of width.
 */
export function KnowledgeSourcesPanel({
  scope,
  description,
}: {
  scope: KnowledgeScope;
  description?: string;
}) {
  const { membership } = useWorkspace();
  const [params, setParams] = useSearchParamState(FILTER_KEYS);
  const [search, setSearch] = useState(params.q ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [pendingDelete, setPendingDelete] = useState<KnowledgeSource | null>(null);
  const [pendingMove, setPendingMove] = useState<KnowledgeSource | null>(null);
  const reprocess = useReprocessSourceMutation();
  const remove = useDeleteSourceMutation();

  // Persist the debounced search term in the URL so it survives reloads.
  useEffect(() => {
    const current = params.q ?? "";
    if (debouncedSearch !== current) setParams({ q: debouncedSearch || undefined });
  }, [debouncedSearch, params.q, setParams]);

  const filters = useMemo(
    () => parseKnowledgeSourceFilters({ ...params, q: debouncedSearch || undefined }, KNOWLEDGE_SOURCES_PAGE_SIZE),
    [params, debouncedSearch],
  );
  const query = useKnowledgeSourcesQuery(scope, filters);
  const busy = reprocess.isPending || remove.isPending;

  // Documents added from a collection page land in it; anywhere else they start
  // unorganized, because there is no collection the user has expressed a choice about.
  const targetCollectionId = scope.kind === "collection" ? scope.collectionId : null;
  const showCollection = scope.kind !== "collection";
  const columns = showCollection ? 7 : 6;

  if (query.isPending) return <AppListSkeleton rows={4} />;
  if (query.isError) {
    return (
      <AppTableContainer>
        <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />
      </AppTableContainer>
    );
  }

  const page = query.data;
  const filtered = Boolean(filters.q);
  const empty = emptyStateFor(scope, targetCollectionId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <AppSearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search sources…"
            aria-label="Search sources"
          />
        </div>
        {/* The empty state carries its own call to action, so the header one
            would be a second identical button beside it. */}
        {page.total > 0 ? <AddSourceButton collectionId={targetCollectionId} variant="secondary" /> : null}
      </div>

      {description ? <p className="text-sm text-foreground-muted">{description}</p> : null}

      <AppTableContainer aria-busy={query.isFetching || undefined}>
        <AppTable>
          <AppTableHeader>
            <AppTableRow>
              <AppTableHead>Source</AppTableHead>
              {showCollection ? <AppTableHead>Collection</AppTableHead> : null}
              <AppTableHead>Status</AppTableHead>
              <AppTableHead>Passages</AppTableHead>
              <AppTableHead>Tokens</AppTableHead>
              <AppTableHead>Updated</AppTableHead>
              <AppTableHead>
                <span className="sr-only">Actions</span>
              </AppTableHead>
            </AppTableRow>
          </AppTableHeader>
          <AppTableBody>
            {page.items.length === 0 ? (
              <AppTableMessageRow colSpan={columns}>
                {filtered ? (
                  <AppEmptyState
                    size="sm"
                    title="No sources match your search"
                    description="Try a different term, or clear the search."
                    action={
                      <AppButton variant="secondary" size="sm" onClick={() => setSearch("")}>
                        Clear search
                      </AppButton>
                    }
                  />
                ) : (
                  <AppEmptyState
                    icon={empty.icon}
                    title={empty.title}
                    description={empty.description}
                    action={empty.action}
                  />
                )}
              </AppTableMessageRow>
            ) : (
              page.items.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  showCollection={showCollection}
                  workspaceSlug={membership.workspace.slug}
                  busy={busy}
                  onReprocess={canEdit(membership.role) ? (target) => reprocess.mutate(target.id) : undefined}
                  onMove={canEdit(membership.role) ? setPendingMove : undefined}
                  onRemove={canManage(membership.role) ? setPendingDelete : undefined}
                />
              ))
            )}
          </AppTableBody>
        </AppTable>
      </AppTableContainer>

      <AppPagination
        page={page.page}
        pageCount={pageCount(page.total, page.pageSize)}
        onPageChange={(next) => setParams({ page: next > 1 ? next : undefined }, { resetPage: false })}
        summary={paginationSummary(page.page, page.pageSize, page.total)}
      />

      <MoveSourceDialog source={pendingMove} onClose={() => setPendingMove(null)} />

      <AppConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          remove.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
        }}
        title={`Remove “${pendingDelete?.name ?? ""}”?`}
        description={`Its ${formatNumber(pendingDelete?.chunkCount ?? 0)} indexed passage(s) are deleted and stop appearing in answers. This cannot be undone.`}
        confirmLabel="Remove source"
        destructive
        loading={remove.isPending}
      />
    </div>
  );
}
