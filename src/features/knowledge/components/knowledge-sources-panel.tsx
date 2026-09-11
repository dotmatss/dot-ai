"use client";

import { ExternalLink, FileStack, MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppButton } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppDropdownMenu, AppDropdownMenuItem } from "@/components/ui/app-dropdown-menu";
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
import { AddSourceButton } from "@/features/knowledge/components/add-source-dialog";
import { KnowledgeSourceStatusBadge } from "@/features/knowledge/components/knowledge-status-badge";
import { SourceTypeIcon } from "@/features/knowledge/components/source-type-icon";
import { KNOWLEDGE_SOURCES_PAGE_SIZE } from "@/features/knowledge/constants";
import { parseKnowledgeSourceFilters } from "@/features/knowledge/filters";
import { useDeleteSourceMutation, useReprocessSourceMutation } from "@/features/knowledge/mutations";
import { useKnowledgeSourcesQuery } from "@/features/knowledge/queries";
import { isSourceInFlight, type KnowledgeSource } from "@/features/knowledge/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { formatNumber } from "@/lib/format/number";
import { pageCount } from "@/types/pagination";
import { AppRelativeTime } from "@/components/ui/app-relative-time";

const FILTER_KEYS = ["page"] as const;
const COLUMNS = 6;

function SourceRow({
  source,
  onReprocess,
  onRemove,
  busy,
}: {
  source: KnowledgeSource;
  onReprocess?: (source: KnowledgeSource) => void;
  onRemove?: (source: KnowledgeSource) => void;
  busy: boolean;
}) {
  const inFlight = isSourceInFlight(source.status);
  const hasActions = Boolean(onReprocess || onRemove);
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

export function KnowledgeSourcesPanel({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const { membership } = useWorkspace();
  const [params, setParams] = useSearchParamState(FILTER_KEYS);
  const [pendingDelete, setPendingDelete] = useState<KnowledgeSource | null>(null);
  const reprocess = useReprocessSourceMutation(knowledgeBaseId);
  const remove = useDeleteSourceMutation(knowledgeBaseId);

  const filters = useMemo(() => parseKnowledgeSourceFilters(params, KNOWLEDGE_SOURCES_PAGE_SIZE), [params]);
  const query = useKnowledgeSourcesQuery(knowledgeBaseId, filters);
  const busy = reprocess.isPending || remove.isPending;

  if (query.isPending) return <AppListSkeleton rows={4} />;
  if (query.isError) {
    return (
      <AppTableContainer>
        <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />
      </AppTableContainer>
    );
  }

  const page = query.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground-muted">
          Each source is split into overlapping passages, embedded and indexed. Retrieval ranks passages, not whole documents.
        </p>
        {page.total > 0 ? <AddSourceButton knowledgeBaseId={knowledgeBaseId} variant="secondary" /> : null}
      </div>

      <AppTableContainer aria-busy={query.isFetching || undefined}>
        <AppTable>
          <AppTableHeader>
            <AppTableRow>
              <AppTableHead>Source</AppTableHead>
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
              <AppTableMessageRow colSpan={COLUMNS}>
                <AppEmptyState
                  icon={<FileStack aria-hidden />}
                  title="No sources yet"
                  description="Paste text, import a public page or upload a text file. Nothing can be retrieved until at least one source is indexed."
                  action={<AddSourceButton knowledgeBaseId={knowledgeBaseId} />}
                />
              </AppTableMessageRow>
            ) : (
              page.items.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  busy={busy}
                  onReprocess={canEdit(membership.role) ? (target) => reprocess.mutate(target.id) : undefined}
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
