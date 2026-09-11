"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { AppFormActions, AppFormField, AppFormSection } from "@/components/forms/form-field";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppButton } from "@/components/ui/app-button";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppInput } from "@/components/ui/app-input";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppTextarea } from "@/components/ui/app-textarea";
import { useDeleteChatbotMutation, useUpdateChatbotMutation } from "@/features/chatbots/mutations";
import { useChatbotQuery } from "@/features/chatbots/queries";
import { chatbotSettingsFormSchema, type ChatbotSettingsFormValues } from "@/features/chatbots/schemas";
import type { Chatbot } from "@/features/chatbots/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";
import { isApiError } from "@/lib/api/api-error";

function SettingsForm({ chatbot }: { chatbot: Chatbot }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const editable = canEdit(membership.role);
  const update = useUpdateChatbotMutation(chatbot.id);
  const remove = useDeleteChatbotMutation();
  const [confirm, setConfirm] = useState(false);
  const form = useForm<ChatbotSettingsFormValues>({
    resolver: zodResolver(chatbotSettingsFormSchema),
    defaultValues: { name: chatbot.name, description: chatbot.description ?? "" },
  });

  // See the instructions form: reconcile rather than remount, so a sibling
  // mutation cannot throw away unsaved edits.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset({ name: chatbot.name, description: chatbot.description ?? "" });
  }, [chatbot, form]);

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
          <AppFormSection title="General" description="Name and description are internal and never shown to visitors.">
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
      <AppFormSection title="Identifiers" description="Useful when integrating through the API.">
        <dl className="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
          <dt className="text-foreground-muted">Chatbot ID</dt>
          <dd className="break-all font-mono text-xs">{chatbot.id}</dd>
          <dt className="text-foreground-muted">Slug</dt>
          <dd className="font-mono text-xs">{chatbot.slug}</dd>
          <dt className="text-foreground-muted">Embed key</dt>
          <dd className="font-mono text-xs">{chatbot.embedKey}</dd>
        </dl>
      </AppFormSection>
      {canManage(membership.role) ? (
        <AppFormSection title="Danger zone" description="Deleting a chatbot disables its embed immediately.">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-danger-border bg-danger-bg/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Delete this chatbot</p>
              <p className="text-xs text-foreground-muted">Configuration is removed; conversations stay available for reporting.</p>
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
        onConfirm={() => remove.mutate(chatbot.id, { onSuccess: () => router.push(`/w/${membership.workspace.slug}/chatbots` as Route) })}
        title={`Delete “${chatbot.name}”?`}
        description="This cannot be undone."
        confirmLabel="Delete chatbot"
        destructive
        loading={remove.isPending}
      />
    </>
  );
}

export function ChatbotSettingsForm({ chatbotId }: { chatbotId: string }) {
  const query = useChatbotQuery(chatbotId);
  if (query.isPending) return <AppSkeleton className="h-96" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <SettingsForm key={query.data.id} chatbot={query.data} />;
}
