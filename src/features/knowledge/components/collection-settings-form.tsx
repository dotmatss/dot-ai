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
import { useDeleteCollectionMutation, useUpdateCollectionMutation } from "@/features/knowledge/mutations";
import { DEFAULT_EMBEDDING_CONFIG } from "@/features/knowledge/constants";
import { useCollectionQuery } from "@/features/knowledge/queries";
import { collectionSettingsFormSchema, type CollectionSettingsFormValues } from "@/features/knowledge/schemas";
import type { Collection } from "@/features/knowledge/types";
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

function SettingsForm({ collection }: { collection: Collection }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const editable = canEdit(membership.role);
  const update = useUpdateCollectionMutation(collection.id);
  const remove = useDeleteCollectionMutation();
  const [confirm, setConfirm] = useState(false);
  const form = useForm<CollectionSettingsFormValues>({
    resolver: zodResolver(collectionSettingsFormSchema),
    defaultValues: { name: collection.name, description: collection.description ?? "" },
  });

  // Keyed on the record id rather than its updatedAt: remounting whenever any
  // sibling mutation touches the record (a status toggle in the header, say)
  // would throw away whatever the user is typing. Reconcile instead, and only
  // when there is nothing to lose.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset({ name: collection.name, description: collection.description ?? "" });
  }, [collection, form]);

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

  const attached = collection.attachedChatbotCount + collection.attachedAgentCount;

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
        title="Indexing"
        description="How content is vectorized is a property of each document, recorded when it was last indexed — not of the collection, so moving a document between collections never re-indexes it. These are the settings a new or reprocessed source is indexed with today."
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr] sm:gap-x-6">
          <DefinitionRow label="Provider">{DEFAULT_EMBEDDING_CONFIG.provider}</DefinitionRow>
          <DefinitionRow label="Dimensions">
            <span className="tabular-nums">{formatNumber(DEFAULT_EMBEDDING_CONFIG.dimensions)}</span>
          </DefinitionRow>
          <DefinitionRow label="Chunk size">
            <span className="tabular-nums">{formatNumber(DEFAULT_EMBEDDING_CONFIG.chunkTargetTokens)}</span> tokens
          </DefinitionRow>
          <DefinitionRow label="Chunk overlap">
            <span className="tabular-nums">{formatNumber(DEFAULT_EMBEDDING_CONFIG.chunkOverlapTokens)}</span> tokens
          </DefinitionRow>
          <DefinitionRow label="Indexed passages">
            <span className="tabular-nums">{formatNumber(collection.chunkCount)}</span>
          </DefinitionRow>
        </dl>
      </AppFormSection>

      <AppFormSection title="Identifiers" description="Useful when integrating through the API.">
        <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr] sm:gap-x-6">
          <DefinitionRow label="Collection ID">
            <span className="break-all font-mono text-xs">{collection.id}</span>
          </DefinitionRow>
          <DefinitionRow label="Attached to">
            {attached === 0
              ? "No chatbots or agents"
              : `${collection.attachedChatbotCount} chatbot(s), ${collection.attachedAgentCount} agent(s)`}
          </DefinitionRow>
        </dl>
      </AppFormSection>

      {canManage(membership.role) ? (
        <AppFormSection
          title="Danger zone"
          description="Deleting a collection removes the grouping. The documents in it are kept."
        >
          <div className="flex flex-col gap-3 rounded-lg border border-danger-border bg-danger-bg/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Delete this collection</p>
              <ul className="mt-1 list-disc pl-4 text-xs text-foreground-muted">
                <li>
                  {formatNumber(collection.sourceCount)} source{collection.sourceCount === 1 ? "" : "s"} and{" "}
                  {formatNumber(collection.chunkCount)} indexed passage{collection.chunkCount === 1 ? "" : "s"} move to
                  Unorganized, intact
                </li>
                <li>
                  {attached === 0 ? "No chatbot or agent" : `${attached} chatbot(s) and agent(s)`} lose this grounding and
                  answer without it, until you file those sources into a collection they use
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
          remove.mutate(collection.id, {
            onSuccess: () => router.push(`/w/${membership.workspace.slug}/knowledge` as Route),
          })
        }
        title={`Delete “${collection.name}”?`}
        description="The grouping and its chatbot and agent attachments are removed. Its sources and their indexed passages are kept and move to Unorganized."
        confirmLabel="Delete collection"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}

export function CollectionSettingsForm({ collectionId }: { collectionId: string }) {
  const query = useCollectionQuery(collectionId);
  if (query.isPending) return <AppSkeleton className="h-96" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <SettingsForm key={query.data.id} collection={query.data} />;
}
