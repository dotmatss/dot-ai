"use client";

import { ChevronRight, History } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useMemo } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppButton } from "@/components/ui/app-button";
import { AppChip } from "@/components/ui/app-chip";
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
import { RunStatusBadge } from "@/features/workflows/components/workflow-status-badge";
import { RunWorkflowButton } from "@/features/workflows/components/run-workflow-dialog";
import { RUN_STATUS_META, TRIGGER_KIND_LABELS } from "@/features/workflows/constants";
import { parseWorkflowRunFilters } from "@/features/workflows/filters";
import { formatDuration } from "@/features/workflows/format";
import { useWorkflowQuery, useWorkflowRunsQuery } from "@/features/workflows/queries";
import { durationMs, WORKFLOW_RUN_STATUSES } from "@/features/workflows/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { formatDateTime } from "@/lib/format/date";
import { pageCount } from "@/types/pagination";
import { AppRelativeTime } from "@/components/ui/app-relative-time";

const FILTER_KEYS = ["runStatus", "runPage"] as const;
const COLUMNS = 6;

export function WorkflowRunsPanel({ workflowId }: { workflowId: string }) {
  const { membership } = useWorkspace();
  const [params, setParams] = useSearchParamState(FILTER_KEYS);
  const filters = useMemo(() => parseWorkflowRunFilters(params), [params]);
  const workflowQuery = useWorkflowQuery(workflowId);
  const query = useWorkflowRunsQuery(workflowId, filters);
  const base = `/w/${membership.workspace.slug}/workflows/${workflowId}/runs`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter runs by status">
          <AppChip selected={!filters.status} onClick={() => setParams({ runStatus: undefined, runPage: undefined })}>
            All
          </AppChip>
          {WORKFLOW_RUN_STATUSES.map((status) => (
            <AppChip
              key={status}
              selected={filters.status === status}
              onClick={() => setParams({ runStatus: filters.status === status ? undefined : status, runPage: undefined })}
            >
              {RUN_STATUS_META[status].label}
            </AppChip>
          ))}
        </div>
        {workflowQuery.data ? (
          <RunWorkflowButton workflowId={workflowId} definition={workflowQuery.data.definition} label="Run workflow" />
        ) : null}
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
                  <AppTableHead>Status</AppTableHead>
                  <AppTableHead>Trigger</AppTableHead>
                  <AppTableHead>Started</AppTableHead>
                  <AppTableHead>Duration</AppTableHead>
                  <AppTableHead>Steps</AppTableHead>
                  <AppTableHead>
                    <span className="sr-only">Details</span>
                  </AppTableHead>
                </AppTableRow>
              </AppTableHeader>
              <AppTableBody>
                {query.data.items.length === 0 ? (
                  <AppTableMessageRow colSpan={COLUMNS}>
                    {filters.status ? (
                      <AppEmptyState
                        size="sm"
                        title={`No ${RUN_STATUS_META[filters.status].label.toLowerCase()} runs`}
                        description="Clear the filter to see every run of this workflow."
                        action={
                          <AppButton variant="secondary" size="sm" onClick={() => setParams({ runStatus: undefined, runPage: undefined })}>
                            Clear filters
                          </AppButton>
                        }
                      />
                    ) : (
                      <AppEmptyState
                        icon={<History aria-hidden />}
                        title="No runs yet"
                        description="Start a run to see each step, its output and how long it took."
                        action={
                          workflowQuery.data ? (
                            <RunWorkflowButton
                              workflowId={workflowId}
                              definition={workflowQuery.data.definition}
                              variant="primary"
                              label="Run workflow"
                            />
                          ) : null
                        }
                      />
                    )}
                  </AppTableMessageRow>
                ) : (
                  query.data.items.map((run) => (
                    <AppTableRow key={run.id}>
                      <AppTableCell>
                        <RunStatusBadge status={run.status} />
                      </AppTableCell>
                      <AppTableCell>
                        <span className="block text-sm">{TRIGGER_KIND_LABELS[run.trigger.kind]}</span>
                        {run.trigger.label ? (
                          <span className="block max-w-xs truncate text-xs text-foreground-muted">{run.trigger.label}</span>
                        ) : null}
                      </AppTableCell>
                      <AppTableCell className="whitespace-nowrap">
                        <span className="block text-sm">
                          <AppRelativeTime value={run.startedAt ?? run.createdAt} />
                        </span>
                        <span className="block text-xs text-foreground-muted">{formatDateTime(run.startedAt ?? run.createdAt)}</span>
                      </AppTableCell>
                      <AppTableCell className="whitespace-nowrap tabular-nums">
                        {formatDuration(durationMs(run.startedAt, run.finishedAt))}
                      </AppTableCell>
                      <AppTableCell className="tabular-nums">{run.stepCount}</AppTableCell>
                      <AppTableCell className="text-right">
                        <Link
                          href={`${base}/${run.id}` as Route}
                          className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-foreground underline-offset-4 hover:underline focus-ring"
                        >
                          Open run
                          <ChevronRight aria-hidden className="size-3.5" />
                        </Link>
                      </AppTableCell>
                    </AppTableRow>
                  ))
                )}
              </AppTableBody>
            </AppTable>
          </AppTableContainer>
          <AppPagination
            page={query.data.page}
            pageCount={pageCount(query.data.total, query.data.pageSize)}
            onPageChange={(page) => setParams({ runPage: page > 1 ? page : undefined }, { resetPage: false })}
            summary={paginationSummary(query.data.page, query.data.pageSize, query.data.total)}
          />
        </>
      )}
    </div>
  );
}
