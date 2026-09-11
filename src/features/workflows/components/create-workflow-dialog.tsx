"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useController, useForm } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppButton } from "@/components/ui/app-button";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppInput } from "@/components/ui/app-input";
import { AppRadio, AppRadioGroup } from "@/components/ui/app-radio";
import { AppTextarea } from "@/components/ui/app-textarea";
import { WORKFLOW_TEMPLATES } from "@/features/workflows/domain/templates";
import { useCreateWorkflowMutation } from "@/features/workflows/mutations";
import { createWorkflowSchema, type CreateWorkflowInput, type CreateWorkflowValues } from "@/features/workflows/schemas";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

const FORM_ID = "create-workflow-form";

type CreateMutation = ReturnType<typeof useCreateWorkflowMutation>;

function CreateWorkflowForm({ mutation, onCreated }: { mutation: CreateMutation; onCreated: () => void }) {
  const router = useRouter();
  const { membership } = useWorkspace();
  const templateGroupId = useId();
  // The schema applies a default for `template`, so the raw form values and the
  // parsed submit values are different types.
  const form = useForm<CreateWorkflowInput, unknown, CreateWorkflowValues>({
    resolver: zodResolver(createWorkflowSchema),
    defaultValues: { name: "", description: "", template: "blank" },
  });
  const template = useController({ control: form.control, name: "template" });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values, {
      onSuccess: (workflow) => {
        onCreated();
        router.push(`/w/${membership.workspace.slug}/workflows/${workflow.id}` as Route);
      },
      onError: (error) => {
        if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
      },
    });
  });

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AppFormField label="Name" error={form.formState.errors.name?.message} required>
        {(field) => <AppInput {...field} {...form.register("name")} placeholder="Qualify inbound leads" autoFocus />}
      </AppFormField>
      <AppFormField
        label="Description"
        optional
        description="Shown in lists to help your team recognise this workflow."
        error={form.formState.errors.description?.message}
      >
        {(field) => (
          <AppTextarea
            {...field}
            {...form.register("description")}
            rows={2}
            placeholder="Classifies new conversations and creates a contact for qualified leads."
          />
        )}
      </AppFormField>

      <AppRadioGroup legend="Start from" className="gap-2">
        {WORKFLOW_TEMPLATES.map((option) => (
          <AppRadio
            key={option.id}
            id={`${templateGroupId}-${option.id}`}
            name="template"
            value={option.id}
            checked={template.field.value === option.id}
            onChange={() => template.field.onChange(option.id)}
            label={option.label}
            description={
              <>
                {option.description}
                <span className="mt-1 block font-mono text-caption text-foreground-subtle">{option.outline.join(" → ")}</span>
              </>
            }
          />
        ))}
      </AppRadioGroup>
    </form>
  );
}

export function CreateWorkflowButton({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  const [open, setOpen] = useState(false);
  const { membership } = useWorkspace();
  const mutation = useCreateWorkflowMutation();
  if (!canEdit(membership.role)) return null;

  return (
    <>
      <AppButton variant={variant} onClick={() => setOpen(true)} leadingIcon={<Plus aria-hidden />}>
        New workflow
      </AppButton>
      <AppDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create workflow"
        description="Pick a starting point. Every template is fully editable in the builder."
        size="lg"
        dismissible={!mutation.isPending}
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancel
            </AppButton>
            <AppButton type="submit" form={FORM_ID} loading={mutation.isPending}>
              Create workflow
            </AppButton>
          </>
        }
      >
        {open ? <CreateWorkflowForm mutation={mutation} onCreated={() => setOpen(false)} /> : null}
      </AppDialog>
    </>
  );
}
