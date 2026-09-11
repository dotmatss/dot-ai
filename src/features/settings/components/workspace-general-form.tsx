"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppFormActions, AppFormField, AppFormSection } from "@/components/forms/form-field";
import { AppButton } from "@/components/ui/app-button";
import { AppInput } from "@/components/ui/app-input";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppText } from "@/components/ui/app-typography";
import { MAX_WORKSPACE_NAME_LENGTH } from "@/features/settings/constants";
import { useRenameWorkspaceMutation } from "@/features/settings/mutations";
import { useWorkspaceGeneralQuery } from "@/features/settings/queries";
import { workspaceGeneralFormSchema, type WorkspaceGeneralFormValues } from "@/features/settings/schemas";
import type { WorkspaceGeneralSettings } from "@/features/settings/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

function GeneralForm({ settings }: { settings: WorkspaceGeneralSettings }) {
  const { membership } = useWorkspace();
  const router = useRouter();
  const editable = canManage(membership.role);
  const rename = useRenameWorkspaceMutation();

  const form = useForm<WorkspaceGeneralFormValues>({
    resolver: zodResolver(workspaceGeneralFormSchema),
    defaultValues: { name: settings.name },
  });

  // Reconcile instead of remounting: keying this form on the record would throw
  // away whatever is being typed every time a sibling mutation touches it.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset({ name: settings.name });
  }, [settings, form]);

  const onSubmit = form.handleSubmit((values) => {
    rename.mutate(values, {
      onSuccess: (updated) => {
        form.reset({ name: updated.name });
        // The workspace switcher and the page title are rendered by the server
        // layout, so they only pick up the new name on a refresh.
        router.refresh();
      },
      onError: (error) => {
        if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
      },
    });
  });

  return (
    <>
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={!editable} className="min-w-0">
          <AppFormSection
            title="Workspace"
            description="The name your team sees in the switcher and across the app."
          >
            <AppFormField
              label="Workspace name"
              required
              error={form.formState.errors.name?.message}
              description={`Up to ${MAX_WORKSPACE_NAME_LENGTH} characters.`}
            >
              {(field) => <AppInput {...field} {...form.register("name")} autoComplete="off" />}
            </AppFormField>
            {editable ? (
              <AppFormActions>
                <AppButton type="submit" loading={rename.isPending} disabled={!form.formState.isDirty}>
                  Save changes
                </AppButton>
              </AppFormActions>
            ) : (
              <AppText size="sm" tone="muted">
                Only admins and owners can rename this workspace.
              </AppText>
            )}
          </AppFormSection>
        </fieldset>
      </form>

      <AppFormSection
        title="Details"
        description="Fixed identifiers. The slug stays put because it is in every bookmark, embed snippet and API URL this workspace has handed out."
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
          <dt className="text-foreground-muted">Slug</dt>
          <dd className="font-mono text-xs">{settings.slug}</dd>
          <dt className="text-foreground-muted">Organization</dt>
          <dd>{settings.organization.name}</dd>
          <dt className="text-foreground-muted">Created</dt>
          <dd>
            <AppRelativeTime value={settings.createdAt} />
          </dd>
        </dl>
      </AppFormSection>
    </>
  );
}

export function WorkspaceGeneralForm() {
  const query = useWorkspaceGeneralQuery();
  if (query.isPending) return <AppSkeleton className="h-80 rounded-lg" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <GeneralForm key={query.data.id} settings={query.data} />;
}
