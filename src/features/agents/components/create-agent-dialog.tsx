"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppButton } from "@/components/ui/app-button";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppInput } from "@/components/ui/app-input";
import { AppTextarea } from "@/components/ui/app-textarea";
import { useCreateAgentMutation } from "@/features/agents/mutations";
import { createAgentSchema, type CreateAgentInput } from "@/features/agents/schemas";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

function CreateAgentForm({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const { membership } = useWorkspace();
  const mutation = useCreateAgentMutation();
  const form = useForm<CreateAgentInput>({
    resolver: zodResolver(createAgentSchema),
    defaultValues: { name: "", description: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values, {
      onSuccess: (agent) => {
        onCreated();
        router.push(`/w/${membership.workspace.slug}/agents/${agent.id}` as Route);
      },
      onError: (error) => {
        if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
      },
    });
  });

  return (
    <form id="create-agent-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AppFormField label="Name" error={form.formState.errors.name?.message} required>
        {(field) => <AppInput {...field} {...form.register("name")} placeholder="Onboarding agent" autoFocus />}
      </AppFormField>
      <AppFormField
        label="Description"
        optional
        description="Shown in lists to help your team recognise this agent."
        error={form.formState.errors.description?.message}
      >
        {(field) => (
          <AppTextarea {...field} {...form.register("description")} rows={3} placeholder="Qualifies new signups and files them in the CRM." />
        )}
      </AppFormField>
    </form>
  );
}

export function CreateAgentButton() {
  const [open, setOpen] = useState(false);
  const { membership } = useWorkspace();
  const mutation = useCreateAgentMutation();
  if (!canEdit(membership.role)) return null;

  return (
    <>
      <AppButton onClick={() => setOpen(true)} leadingIcon={<Plus aria-hidden />}>
        New agent
      </AppButton>
      <AppDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create agent"
        description="Name the agent. Instructions, tools, knowledge and memory come next."
        dismissible={!mutation.isPending}
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancel
            </AppButton>
            <AppButton type="submit" form="create-agent-form" loading={mutation.isPending}>
              Create agent
            </AppButton>
          </>
        }
      >
        <CreateAgentForm onCreated={() => setOpen(false)} />
      </AppDialog>
    </>
  );
}
