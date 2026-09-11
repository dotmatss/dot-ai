"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppFormActions, AppFormField, AppFormSection } from "@/components/forms/form-field";
import { AppButton } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppInput } from "@/components/ui/app-input";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppTextarea } from "@/components/ui/app-textarea";
import { useDeleteKnowledgeBaseMutation, useUpdateKnowledgeBaseMutation } from "@/features/knowledge/mutations";
import { useKnowledgeBaseQuery } from "@/features/knowledge/queries";
import { knowledgeBaseSettingsFormSchema, type KnowledgeBaseSettingsFormValues } from "@/features/knowledge/schemas";
import type { KnowledgeBase } from "@/features/knowledge/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";
import { formatNumber } from "@/lib/format/number";

function DefinitionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </>
  );
}

function SettingsForm({ knowledgeBase }: { knowledgeBase: KnowledgeBase }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const editable = canEdit(membership.role);
  const update = useUpdateKnowledgeBaseMutation(knowledgeBase.id);
  const remove = useDeleteKnowledgeBaseMutation();
  const [confirm, setConfirm] = useState(false);
  const form = useForm<KnowledgeBaseSettingsFormValues>({
    resolver: zodResolver(knowledgeBaseSettingsFormSchema),
    defaultValues: { name: knowledgeBase.name, description: knowledgeBase.description ?? "" },
  });

  // Keyed on the record id rather than its updatedAt: remounting whenever any
  // sibling mutation touches the record (a status toggle in the header, say)
  // would throw away whatever the user is typing. Reconcile instead, and only
  // when there is nothing to lose.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset({ name: knowledgeBase.name, description: knowledgeBase.description ?? "" });
  }, [knowledgeBase, form]);

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

  const { embeddingConfig } = knowledgeBase;
  const attached = knowledgeBase.attachedChatbotCount + knowledgeBase.attachedAgentCount;

  return (
    <>
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={!editable} className="min-w-0">
          <AppFormSection
            title="General"
            description="The name and description are internal; visitors never see them."
          >
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

      <AppFormSection
        title="Embedding configuration"
        description="Recorded when this knowledge base was created, so a later provider change is never mixed into the same index. Reprocess all sources to re-embed with a new configuration."
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr] sm:gap-x-6">
          <DefinitionRow label="Provider">{embeddingConfig.provider}</DefinitionRow>
          <DefinitionRow label="Dimensions">
            <span className="tabular-nums">{formatNumber(embeddingConfig.dimensions)}</span>
          </DefinitionRow>
          <DefinitionRow label="Chunk size">
            <span className="tabular-nums">{formatNumber(embeddingConfig.chunkTargetTokens)}</span> tokens
          </DefinitionRow>
          <DefinitionRow label="Chunk overlap">
            <span className="tabular-nums">{formatNumber(embeddingConfig.chunkOverlapTokens)}</span> tokens
          </DefinitionRow>
          <DefinitionRow label="Indexed passages">
            <span className="tabular-nums">{formatNumber(knowledgeBase.chunkCount)}</span>
          </DefinitionRow>
        </dl>
      </AppFormSection>

      <AppFormSection title="Identifiers" description="Useful when integrating through the API.">
        <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr] sm:gap-x-6">
          <DefinitionRow label="Knowledge base ID">
            <span className="break-all font-mono text-xs">{knowledgeBase.id}</span>
          </DefinitionRow>
          <DefinitionRow label="Attached to">
            {attached === 0
              ? "No chatbots or agents"
              : `${knowledgeBase.attachedChatbotCount} chatbot(s), ${knowledgeBase.attachedAgentCount} agent(s)`}
          </DefinitionRow>
        </dl>
      </AppFormSection>

      {canManage(membership.role) ? (
        <AppFormSection title="Danger zone" description="Deleting a knowledge base cascades to everything derived from it.">
          <div className="flex flex-col gap-3 rounded-lg border border-danger-border bg-danger-bg/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Delete this knowledge base</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-foreground-muted">
                <li>
                  {formatNumber(knowledgeBase.sourceCount)} source{knowledgeBase.sourceCount === 1 ? "" : "s"} and{" "}
                  {formatNumber(knowledgeBase.chunkCount)} indexed passage{knowledgeBase.chunkCount === 1 ? "" : "s"} are
                  deleted
                </li>
                <li>
                  {attached === 0 ? "No chatbot or agent" : `${attached} chatbot(s) and agent(s)`} lose this grounding and
                  answer without it
                </li>
                <li>Past conversations and their citations are kept</li>
              </ul>
            </div>
            <AppButton variant="danger" size="sm" onClick={() => setConfirm(true)} className="sm:self-start">
              Delete
            </AppButton>
          </div>
        </AppFormSection>
      ) : null}

      <AppConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          remove.mutate(knowledgeBase.id, {
            onSuccess: () => router.push(`/w/${membership.workspace.slug}/knowledge` as Route),
          })
        }
        title={`Delete “${knowledgeBase.name}”?`}
        description="Sources, indexed passages and attachments are removed. This cannot be undone."
        confirmLabel="Delete knowledge base"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}

export function KnowledgeSettingsForm({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const query = useKnowledgeBaseQuery(knowledgeBaseId);
  if (query.isPending) return <AppSkeleton className="h-96" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <SettingsForm key={query.data.id} knowledgeBase={query.data} />;
}
