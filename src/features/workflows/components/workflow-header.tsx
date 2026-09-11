"use client";

import { Archive, MoreHorizontal, Pause, Play, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { PageHeader } from "@/components/layout/page-header";
import { AppButton } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppDropdownMenu, AppDropdownMenuItem, AppDropdownMenuSeparator } from "@/components/ui/app-dropdown-menu";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { RunWorkflowButton } from "@/features/workflows/components/run-workflow-dialog";
import { WorkflowStatusBadge } from "@/features/workflows/components/workflow-status-badge";
import { definitionErrors, validateDefinition } from "@/features/workflows/domain/definition";
import { useDeleteWorkflowMutation, useUpdateWorkflowMutation } from "@/features/workflows/mutations";
import { useWorkflowQuery } from "@/features/workflows/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";

export function WorkflowHeader({ workflowId }: { workflowId: string }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const query = useWorkflowQuery(workflowId);
  const update = useUpdateWorkflowMutation(workflowId, { silent: true });
  const remove = useDeleteWorkflowMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const base = `/w/${membership.workspace.slug}/workflows` as Route;

  const blocking = useMemo(
    () => (query.data ? definitionErrors(validateDefinition(query.data.definition)) : []),
    [query.data],
  );

  if (query.isPending) {
    return (
      <div className="flex items-center gap-4" aria-busy="true">
        <AppSkeleton className="size-12 rounded-lg" />
        <div className="flex flex-col gap-2">
          <AppSkeleton className="h-6 w-56" />
          <AppSkeleton className="h-3 w-40" />
        </div>
      </div>
    );
  }
  if (query.isError) {
    return <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />;
  }

  const workflow = query.data;
  const editable = canEdit(membership.role);
  const firstBlocking = blocking[0];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Workflows", href: base }, { label: workflow.name }]}
        leading={
          <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-foreground-secondary shadow-xs">
            <WorkflowIcon aria-hidden className="size-5" />
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {workflow.name}
            <WorkflowStatusBadge status={workflow.status} />
          </span>
        }
        description={
          workflow.description ??
          `${workflow.stepCount} step${workflow.stepCount === 1 ? "" : "s"} · version ${workflow.version} · ${workflow.runCount} run${workflow.runCount === 1 ? "" : "s"}`
        }
        actions={
          <>
            <RunWorkflowButton workflowId={workflow.id} definition={workflow.definition} />
            {editable ? (
              workflow.status === "active" ? (
                <AppButton
                  variant="secondary"
                  leadingIcon={<Pause aria-hidden />}
                  loading={update.isPending}
                  onClick={() => update.mutate({ status: "paused" })}
                >
                  Pause
                </AppButton>
              ) : (
                <AppButton
                  leadingIcon={<Play aria-hidden />}
                  loading={update.isPending}
                  disabled={Boolean(firstBlocking)}
                  title={firstBlocking ? `Fix the builder issues first: ${firstBlocking.message}` : undefined}
                  onClick={() => update.mutate({ status: "active" })}
                >
                  {workflow.status === "draft" ? "Activate" : "Resume"}
                </AppButton>
              )
            ) : null}
            {editable ? (
              <AppDropdownMenu
                label="More actions"
                trigger={
                  <AppButton variant="secondary" size="icon" aria-label="More actions">
                    <MoreHorizontal aria-hidden />
                  </AppButton>
                }
              >
                {workflow.status !== "archived" ? (
                  <AppDropdownMenuItem icon={<Archive aria-hidden />} onSelect={() => update.mutate({ status: "archived" })}>
                    Archive
                  </AppDropdownMenuItem>
                ) : (
                  <AppDropdownMenuItem icon={<Play aria-hidden />} onSelect={() => update.mutate({ status: "draft" })}>
                    Restore to draft
                  </AppDropdownMenuItem>
                )}
                {canManage(membership.role) ? (
                  <>
                    <AppDropdownMenuSeparator />
                    <AppDropdownMenuItem destructive icon={<Trash2 aria-hidden />} onSelect={() => setConfirmDelete(true)}>
                      Delete workflow
                    </AppDropdownMenuItem>
                  </>
                ) : null}
              </AppDropdownMenu>
            ) : null}
          </>
        }
      />
      <AppConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate(workflow.id, { onSuccess: () => router.push(base) })}
        title={`Delete “${workflow.name}”?`}
        description="The workflow and its run history are removed and triggers stop firing immediately. This cannot be undone."
        confirmLabel="Delete workflow"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}
