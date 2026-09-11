"use client";

import { History, MoreHorizontal, SquarePen, Trash2, Workflow } from "lucide-react";
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
import { CreateWorkflowButton } from "@/features/workflows/components/create-workflow-dialog";
import { RunStatusBadge, WorkflowStatusBadge } from "@/features/workflows/components/workflow-status-badge";
import { WORKFLOW_STATUS_META } from "@/features/workflows/constants";
import { parseWorkflowFilters } from "@/features/workflows/filters";
import { useDeleteWorkflowMutation } from "@/features/workflows/mutations";
import { useWorkflowsQuery } from "@/features/workflows/queries";
import { WORKFLOW_STATUSES, type WorkflowSummary } from "@/features/workflows/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { pageCount } from "@/types/pagination";
import { AppRelativeTime } from "@/components/ui/app-relative-time";

const FILTER_KEYS = ["q", "status", "page"] as const;
const COLUMNS = 6;

function WorkflowRow({ workflow, onDelete }: { workflow: WorkflowSummary; onDelete?: (workflow: WorkflowSummary) => void }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const href = `/w/${membership.workspace.slug}/workflows/${workflow.id}` as Route;

  return (
    <AppTableRow>
      <AppTableCell>
        <Link href={href} className="group flex items-center gap-3 rounded-md focus-ring">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
            <Workflow aria-hidden className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground group-hover:underline group-hover:underline-offset-4">
              {workflow.name}
            </span>
            <span className="block max-w-md truncate text-xs text-foreground-muted">
              {workflow.description ?? `${workflow.stepCount} step${workflow.stepCount === 1 ? "" : "s"} · v${workflow.version}`}
            </span>
          </span>
        </Link>
      </AppTableCell>
      <AppTableCell>
        <WorkflowStatusBadge status={workflow.status} />
      </AppTableCell>
      <AppTableCell className="tabular-nums">{workflow.stepCount}</AppTableCell>
      <AppTableCell className="tabular-nums">{workflow.runCount}</AppTableCell>
      <AppTableCell className="whitespace-nowrap">
        {workflow.lastRunStatus && workflow.lastRunAt ? (
          <span className="flex items-center gap-2">
            <RunStatusBadge status={workflow.lastRunStatus} size="sm" />
            <span className="text-xs text-foreground-muted">
              <AppRelativeTime value={workflow.lastRunAt} />
            </span>
          </span>
        ) : (
          <span className="text-xs text-foreground-muted">Never run</span>
        )}
      </AppTableCell>
      <AppTableCell className="w-12 text-right">
        <AppDropdownMenu
          label={`Actions for ${workflow.name}`}
          trigger={
            <AppButton variant="ghost" size="icon-sm" aria-label={`Actions for ${workflow.name}`}>
              <MoreHorizontal aria-hidden />
            </AppButton>
          }
        >
          <AppDropdownMenuItem icon={<SquarePen aria-hidden />} onSelect={() => router.push(href)}>
            Open builder
          </AppDropdownMenuItem>
          <AppDropdownMenuItem icon={<History aria-hidden />} onSelect={() => router.push(`${href}/runs` as Route)}>
            View runs
          </AppDropdownMenuItem>
          {onDelete ? (
            <AppDropdownMenuItem destructive icon={<Trash2 aria-hidden />} onSelect={() => onDelete(workflow)}>
              Delete
            </AppDropdownMenuItem>
          ) : null}
        </AppDropdownMenu>
      </AppTableCell>
    </AppTableRow>
  );
}

export function WorkflowsList() {
  const { membership } = useWorkspace();
  const [params, setParams] = useSearchParamState(FILTER_KEYS);
  const [search, setSearch] = useState(params.q ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [pendingDelete, setPendingDelete] = useState<WorkflowSummary | null>(null);
  const deleteMutation = useDeleteWorkflowMutation();

  // Persist the debounced search term in the URL so it survives reloads.
  useEffect(() => {
    const current = params.q ?? "";
    if (debouncedSearch !== current) setParams({ q: debouncedSearch || undefined });
  }, [debouncedSearch, params.q, setParams]);

  const filters = useMemo(() => parseWorkflowFilters({ ...params, q: debouncedSearch || undefined }), [params, debouncedSearch]);
  const query = useWorkflowsQuery(filters);
  const hasFilters = Boolean(filters.q || filters.status);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <AppSearchInput value={search} onValueChange={setSearch} placeholder="Search workflows…" aria-label="Search workflows" />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
          <AppChip selected={!filters.status} onClick={() => setParams({ status: undefined })}>
            All
          </AppChip>
          {WORKFLOW_STATUSES.map((status) => (
            <AppChip
              key={status}
              selected={filters.status === status}
              onClick={() => setParams({ status: filters.status === status ? undefined : status })}
            >
              {WORKFLOW_STATUS_META[status].label}
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
                  <AppTableHead>Workflow</AppTableHead>
                  <AppTableHead>Status</AppTableHead>
                  <AppTableHead>Steps</AppTableHead>
                  <AppTableHead>Runs</AppTableHead>
                  <AppTableHead>Last run</AppTableHead>
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
                        title="No workflows match your filters"
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
                        icon={<Workflow aria-hidden />}
                        title="Automate your first process"
                        description="A workflow reacts to a trigger, runs AI and logic steps in order, and records every run so you can see what happened."
                        action={<CreateWorkflowButton />}
                      />
                    )}
                  </AppTableMessageRow>
                ) : (
                  query.data.items.map((workflow) => (
                    <WorkflowRow
                      key={workflow.id}
                      workflow={workflow}
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
        description="The workflow and its run history are removed. Triggers stop firing immediately. This cannot be undone."
        confirmLabel="Delete workflow"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
