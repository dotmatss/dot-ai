"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppFormActions, AppFormField, AppFormSection } from "@/components/forms/form-field";
import { AppButton } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppInput } from "@/components/ui/app-input";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppTextarea } from "@/components/ui/app-textarea";
import { AppText } from "@/components/ui/app-typography";
import { WorkflowStatusBadge } from "@/features/workflows/components/workflow-status-badge";
import { WORKFLOW_STATUS_META } from "@/features/workflows/constants";
import { useDeleteWorkflowMutation, useUpdateWorkflowMutation } from "@/features/workflows/mutations";
import { useWorkflowQuery } from "@/features/workflows/queries";
import { workflowSettingsFormSchema, type WorkflowSettingsFormValues } from "@/features/workflows/schemas";
import type { Workflow } from "@/features/workflows/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";
import { formatDateTime } from "@/lib/format/date";

function SettingsForm({ workflow }: { workflow: Workflow }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const editable = canEdit(membership.role);
  const update = useUpdateWorkflowMutation(workflow.id);
  const remove = useDeleteWorkflowMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const base = `/w/${membership.workspace.slug}/workflows` as Route;

  const form = useForm<WorkflowSettingsFormValues>({
    resolver: zodResolver(workflowSettingsFormSchema),
    defaultValues: { name: workflow.name, description: workflow.description ?? "" },
  });

  // Keyed on the record id rather than its updatedAt: remounting whenever any
  // sibling mutation touches the record (a status toggle in the header, say)
  // would throw away whatever the user is typing. Reconcile instead, and only
  // when there is nothing to lose.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset({ name: workflow.name, description: workflow.description ?? "" });
  }, [workflow, form]);

  const onSubmit = form.handleSubmit((values) => {
    update.mutate(
      { name: values.name, description: values.description || null },
      {
        onSuccess: (updated) => form.reset({ name: updated.name, description: updated.description ?? "" }),
        onError: (error) => {
          if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
        },
      },
    );
  });

  return (
    <>
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={!editable} className="min-w-0">
          <AppFormSection title="Details" description="Name and description are internal and only shown to your team.">
            <AppFormField label="Name" required error={form.formState.errors.name?.message}>
              {(field) => <AppInput {...field} {...form.register("name")} />}
            </AppFormField>
            <AppFormField label="Description" optional error={form.formState.errors.description?.message}>
              {(field) => <AppTextarea {...field} {...form.register("description")} rows={3} />}
            </AppFormField>
            {editable ? (
              <AppFormActions>
                <AppButton type="submit" loading={update.isPending} disabled={!form.formState.isDirty}>
                  Save changes
                </AppButton>
              </AppFormActions>
            ) : null}
          </AppFormSection>
        </fieldset>
      </form>

      <AppFormSection title="Status" description="Activation and pausing are managed from the workflow header.">
        <div className="flex flex-wrap items-center gap-3">
          <WorkflowStatusBadge status={workflow.status} />
          <AppText size="sm" tone="muted">
            {WORKFLOW_STATUS_META[workflow.status].description}
          </AppText>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
          <dt className="text-foreground-muted">Workflow ID</dt>
          <dd className="break-all font-mono text-xs">{workflow.id}</dd>
          <dt className="text-foreground-muted">Saved version</dt>
          <dd className="tabular-nums">{workflow.version}</dd>
          <dt className="text-foreground-muted">Steps</dt>
          <dd className="tabular-nums">{workflow.stepCount}</dd>
          <dt className="text-foreground-muted">Created</dt>
          <dd>{formatDateTime(workflow.createdAt)}</dd>
          <dt className="text-foreground-muted">Last updated</dt>
          <dd>{formatDateTime(workflow.updatedAt)}</dd>
        </dl>
      </AppFormSection>

      {canManage(membership.role) ? (
        <AppFormSection title="Danger zone" description="Deleting a workflow also removes its run history.">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-danger-border bg-danger-bg/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Delete this workflow</p>
              <p className="text-xs text-foreground-muted">
                Triggers stop firing immediately and every recorded run is removed.
              </p>
            </div>
            <AppButton variant="danger" size="sm" leadingIcon={<Trash2 aria-hidden />} onClick={() => setConfirmDelete(true)}>
              Delete
            </AppButton>
          </div>
        </AppFormSection>
      ) : null}

      <AppConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate(workflow.id, { onSuccess: () => router.push(base) })}
        title={`Delete “${workflow.name}”?`}
        description="The workflow and its run history are removed. This cannot be undone."
        confirmLabel="Delete workflow"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}

export function WorkflowSettingsForm({ workflowId }: { workflowId: string }) {
  const query = useWorkflowQuery(workflowId);
  if (query.isPending) return <AppSkeleton className="h-96" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <SettingsForm key={query.data.id} workflow={query.data} />;
}
