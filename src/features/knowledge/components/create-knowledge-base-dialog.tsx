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
import { useCreateKnowledgeBaseMutation } from "@/features/knowledge/mutations";
import { createKnowledgeBaseSchema, type CreateKnowledgeBaseInput } from "@/features/knowledge/schemas";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

const FORM_ID = "create-knowledge-base-form";

type CreateMutation = ReturnType<typeof useCreateKnowledgeBaseMutation>;

function CreateKnowledgeBaseForm({ mutation, onCreated }: { mutation: CreateMutation; onCreated: () => void }) {
  const router = useRouter();
  const { membership } = useWorkspace();
  const form = useForm<CreateKnowledgeBaseInput>({
    resolver: zodResolver(createKnowledgeBaseSchema),
    defaultValues: { name: "", description: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values, {
      onSuccess: (base) => {
        onCreated();
        router.push(`/w/${membership.workspace.slug}/knowledge/${base.id}` as Route);
      },
      onError: (error) => {
        if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
      },
    });
  });

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AppFormField label="Name" error={form.formState.errors.name?.message} required>
        {(field) => <AppInput {...field} {...form.register("name")} placeholder="Product documentation" autoFocus />}
      </AppFormField>
      <AppFormField
        label="Description"
        optional
        description="Shown in lists and when attaching this knowledge base to a chatbot or agent."
        error={form.formState.errors.description?.message}
      >
        {(field) => (
          <AppTextarea
            {...field}
            {...form.register("description")}
            rows={3}
            placeholder="Public help centre articles and the pricing page."
          />
        )}
      </AppFormField>
    </form>
  );
}

export function CreateKnowledgeBaseButton({ size }: { size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const { membership } = useWorkspace();
  // Owned here, not in the form, so the dialog footer and its dismiss guard see
  // the same pending state the submit is driving.
  const mutation = useCreateKnowledgeBaseMutation();
  if (!canEdit(membership.role)) return null;

  return (
    <>
      <AppButton onClick={() => setOpen(true)} leadingIcon={<Plus aria-hidden />} size={size}>
        New knowledge base
      </AppButton>
      <AppDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create knowledge base"
        description="Name it now; add text, URLs and files once it exists."
        dismissible={!mutation.isPending}
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancel
            </AppButton>
            <AppButton type="submit" form={FORM_ID} loading={mutation.isPending}>
              Create knowledge base
            </AppButton>
          </>
        }
      >
        <CreateKnowledgeBaseForm mutation={mutation} onCreated={() => setOpen(false)} />
      </AppDialog>
    </>
  );
}
