"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { createWorkspaceAction } from "@/features/workspaces/actions";
import { createWorkspaceSchema, type CreateWorkspaceInput } from "@/features/workspaces/schemas";
import type { OrganizationSummary } from "@/features/workspaces/types";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

export function CreateWorkspaceForm({ organizations }: { organizations: OrganizationSummary[] }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<CreateWorkspaceInput>({
    resolver: zodResolver(createWorkspaceSchema),
    defaultValues: { name: "", organizationId: organizations[0]?.id ?? "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      const result = await createWorkspaceAction(values);
      if (result && !result.ok) {
        setServerError(result.error);
        applyFieldErrors(form.setError, result.fieldErrors);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {serverError ? <AppAlert tone="danger">{serverError}</AppAlert> : null}
      {organizations.length > 1 ? (
        <AppFormField label="Organization" error={form.formState.errors.organizationId?.message} required>
          {(field) => (
            <AppSelect
              {...field}
              {...form.register("organizationId")}
              options={organizations.map((org) => ({ value: org.id, label: org.name }))}
            />
          )}
        </AppFormField>
      ) : null}
      <AppFormField
        label="Workspace name"
        description="Workspaces keep chatbots, knowledge and customers separate, e.g. per product or brand."
        error={form.formState.errors.name?.message}
        required
      >
        {(field) => <AppInput {...field} {...form.register("name")} placeholder="Customer Support" autoFocus />}
      </AppFormField>
      <AppButton type="submit" fullWidth loading={pending} size="lg">
        Create workspace
      </AppButton>
    </form>
  );
}
