"use client";

import { zodResolver } from "@hookform/resolvers/zod";
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
import { useDeleteAgentMutation, useUpdateAgentMutation } from "@/features/agents/mutations";
import { useAgentQuery } from "@/features/agents/queries";
import { agentSettingsFormSchema, type AgentSettingsFormValues } from "@/features/agents/schemas";
import type { Agent } from "@/features/agents/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

function SettingsForm({ agent }: { agent: Agent }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const editable = canEdit(membership.role);
  const update = useUpdateAgentMutation(agent.id);
  const remove = useDeleteAgentMutation();
  const [confirm, setConfirm] = useState(false);
  const form = useForm<AgentSettingsFormValues>({
    resolver: zodResolver(agentSettingsFormSchema),
    defaultValues: { name: agent.name, description: agent.description ?? "" },
  });

  // Keyed on the record id rather than its updatedAt: remounting whenever any
  // sibling mutation touches the record (a status toggle in the header, say)
  // would throw away whatever the user is typing. Reconcile instead, and only
  // when there is nothing to lose.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset({ name: agent.name, description: agent.description ?? "" });
  }, [agent, form]);

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
          <AppFormSection title="General" description="Name and description are internal; they help your team recognise this agent.">
            <AppFormField label="Name" error={form.formState.errors.name?.message} required>
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
      <AppFormSection title="Identifiers" description="Useful when calling this agent from a workflow or the API.">
        <dl className="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
          <dt className="text-foreground-muted">Agent ID</dt>
          <dd className="break-all font-mono text-xs">{agent.id}</dd>
          <dt className="text-foreground-muted">Status</dt>
          <dd className="text-xs">{agent.status}</dd>
        </dl>
      </AppFormSection>
      {canManage(membership.role) ? (
        <AppFormSection title="Danger zone" description="Deleting an agent stops every caller that references it.">
          <div className="flex flex-col gap-3 rounded-lg border border-danger-border bg-danger-bg/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Delete this agent</p>
              <p className="text-xs text-foreground-muted">
                Instructions, tools, memory settings and knowledge links are removed; conversations stay available for reporting.
              </p>
            </div>
            <AppButton variant="danger" size="sm" onClick={() => setConfirm(true)}>
              Delete
            </AppButton>
          </div>
        </AppFormSection>
      ) : null}
      <AppConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate(agent.id, { onSuccess: () => router.push(`/w/${membership.workspace.slug}/agents` as Route) })}
        title={`Delete “${agent.name}”?`}
        description="This cannot be undone."
        confirmLabel="Delete agent"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}

export function AgentSettingsForm({ agentId }: { agentId: string }) {
  const query = useAgentQuery(agentId);
  if (query.isPending) return <AppSkeleton className="h-96" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <SettingsForm key={query.data.id} agent={query.data} />;
}
