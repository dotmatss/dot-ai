"use client";

import { ChevronLeft, CircleDot, RotateCcw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AppDetailSkeleton } from "@/components/feedback/app-loading";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppCodeBlock } from "@/components/ui/app-code-block";
import { AppStat } from "@/components/ui/app-stat";
import { AppCaption } from "@/components/ui/app-typography";
import { RunStatusBadge, StepStatusBadge } from "@/features/workflows/components/workflow-status-badge";
import { RUN_STATUS_META, TRIGGER_KIND_LABELS } from "@/features/workflows/constants";
import { NODE_TYPES, type NodeTypeDefinition } from "@/features/workflows/domain/node-types";
import { formatDuration, formatJson } from "@/features/workflows/format";
import { useStartWorkflowRunMutation } from "@/features/workflows/mutations";
import { useWorkflowRunQuery } from "@/features/workflows/queries";
import { durationMs, type WorkflowRunStep } from "@/features/workflows/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { formatDateTime } from "@/lib/format/date";

function isSimulated(step: WorkflowRunStep): boolean {
  return step.output?.simulated === true;
}

function StepTimelineItem({ step, index, last }: { step: WorkflowRunStep; index: number; last: boolean }) {
  const nodeType = NODE_TYPES[step.type] as NodeTypeDefinition | undefined;
  const Icon = nodeType?.icon ?? CircleDot;
  const elapsed = durationMs(step.startedAt, step.finishedAt);

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center" aria-hidden>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-caption font-semibold tabular-nums text-foreground-secondary">
          {index}
        </span>
        {last ? null : <span className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <div className="min-w-0 flex-1 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary [&_svg]:size-3.5">
            <Icon aria-hidden />
          </span>
          <span className="truncate text-sm font-medium text-foreground">{step.label}</span>
          <AppCaption>{nodeType?.label ?? step.type}</AppCaption>
          <StepStatusBadge status={step.status} size="sm" />
          {isSimulated(step) ? (
            <AppBadge tone="info" size="sm" variant="outline">
              Simulated
            </AppBadge>
          ) : null}
          <span className="ml-auto shrink-0 text-xs tabular-nums text-foreground-muted">{formatDuration(elapsed)}</span>
        </div>

        {step.error ? (
          <AppAlert tone="danger" className="mt-2" title="Step failed">
            {step.error}
          </AppAlert>
        ) : null}

        {step.output ? (
          <details className="group mt-2">
            <summary className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-foreground-secondary hover:text-foreground focus-ring">
              Output
              <span aria-hidden className="text-foreground-subtle group-open:hidden">
                (show)
              </span>
              <span aria-hidden className="hidden text-foreground-subtle group-open:inline">
                (hide)
              </span>
            </summary>
            <AppCodeBlock className="mt-2" label={`${step.nodeId} output`} code={formatJson(step.output)} />
          </details>
        ) : null}
      </div>
    </li>
  );
}

export function WorkflowRunDetail({ workflowId, runId }: { workflowId: string; runId: string }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const query = useWorkflowRunQuery(workflowId, runId);
  const startRun = useStartWorkflowRunMutation(workflowId);
  const runsHref = `/w/${membership.workspace.slug}/workflows/${workflowId}/runs` as Route;

  if (query.isPending) return <AppDetailSkeleton />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const run = query.data;
  const elapsed = durationMs(run.startedAt, run.finishedAt);
  const failedStep = run.steps.find((step) => step.status === "failed");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Link
            href={runsHref}
            className="inline-flex w-fit items-center gap-1 rounded-xs text-xs font-medium text-foreground-muted hover:text-foreground focus-ring"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
            All runs
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <RunStatusBadge status={run.status} />
            <span className="text-sm text-foreground-muted">
              {TRIGGER_KIND_LABELS[run.trigger.kind]} · {formatDateTime(run.startedAt ?? run.createdAt)}
            </span>
          </div>
          <AppCaption>{RUN_STATUS_META[run.status].description}</AppCaption>
        </div>
        {canEdit(membership.role) ? (
          <AppButton
            variant="secondary"
            leadingIcon={<RotateCcw aria-hidden />}
            loading={startRun.isPending}
            onClick={() =>
              startRun.mutate(
                { input: run.input ?? {} },
                { onSuccess: (next) => router.push(`${runsHref}/${next.id}` as Route) },
              )
            }
          >
            Run again
          </AppButton>
        ) : null}
      </div>

      {run.error ? (
        <AppAlert tone="danger" title="This run failed">
          {run.error}
          {failedStep ? <span className="mt-1 block text-xs">Failed at step “{failedStep.label}”.</span> : null}
        </AppAlert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <AppStat label="Duration" value={formatDuration(elapsed)} />
        <AppStat label="Steps" value={String(run.steps.length)} />
        <AppStat label="Simulated steps" value={String(run.steps.filter(isSimulated).length)} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <AppCard>
          <AppCardHeader>
            <AppCardTitle>Input</AppCardTitle>
          </AppCardHeader>
          <AppCardContent>
            {run.input && Object.keys(run.input).length > 0 ? (
              <AppCodeBlock label="run input" code={formatJson(run.input)} />
            ) : (
              <AppCaption>This run started without input.</AppCaption>
            )}
          </AppCardContent>
        </AppCard>
        <AppCard>
          <AppCardHeader>
            <AppCardTitle>Output</AppCardTitle>
          </AppCardHeader>
          <AppCardContent>
            {run.output && Object.keys(run.output).length > 0 ? (
              <AppCodeBlock label="run output" code={formatJson(run.output)} />
            ) : (
              <AppCaption>No response step produced output.</AppCaption>
            )}
          </AppCardContent>
        </AppCard>
      </div>

      <AppCard>
        <AppCardHeader>
          <AppCardTitle>Step timeline</AppCardTitle>
        </AppCardHeader>
        <AppCardContent>
          {run.steps.length === 0 ? (
            <AppCaption>This run stopped before any step executed.</AppCaption>
          ) : (
            <ol className="flex flex-col">
              {run.steps.map((step, index) => (
                <StepTimelineItem
                  key={`${step.nodeId}-${index}`}
                  step={step}
                  index={index + 1}
                  last={index === run.steps.length - 1}
                />
              ))}
            </ol>
          )}
        </AppCardContent>
      </AppCard>
    </div>
  );
}
