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
import { useCreateChatbotMutation } from "@/features/chatbots/mutations";
import { createChatbotSchema, type CreateChatbotInput } from "@/features/chatbots/schemas";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";
import { isApiError } from "@/lib/api/api-error";

function CreateChatbotForm({
  mutation,
  onCreated,
}: {
  mutation: ReturnType<typeof useCreateChatbotMutation>;
  onCreated: () => void;
}) {
  const router = useRouter();
  const { membership } = useWorkspace();
  const form = useForm<CreateChatbotInput>({
    resolver: zodResolver(createChatbotSchema),
    defaultValues: { name: "", description: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values, {
      onSuccess: (chatbot) => {
        onCreated();
        router.push(`/w/${membership.workspace.slug}/chatbots/${chatbot.id}` as Route);
      },
      onError: (error) => {
        if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
      },
    });
  });

  return (
    <form id="create-chatbot-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AppFormField label="Name" error={form.formState.errors.name?.message} required>
        {(field) => <AppInput {...field} {...form.register("name")} placeholder="Support assistant" autoFocus />}
      </AppFormField>
      <AppFormField
        label="Description"
        optional
        description="Shown in lists to help your team recognise this chatbot."
        error={form.formState.errors.description?.message}
      >
        {(field) => <AppTextarea {...field} {...form.register("description")} rows={3} placeholder="Answers questions about pricing and onboarding." />}
      </AppFormField>
    </form>
  );
}

export function CreateChatbotButton() {
  const [open, setOpen] = useState(false);
  const { membership } = useWorkspace();
  const mutation = useCreateChatbotMutation();
  if (!canEdit(membership.role)) return null;

  return (
    <>
      <AppButton onClick={() => setOpen(true)} leadingIcon={<Plus aria-hidden />}>
        New chatbot
      </AppButton>
      <AppDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create chatbot"
        description="Give your chatbot a name. You can configure instructions, knowledge and appearance next."
        dismissible={!mutation.isPending}
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancel
            </AppButton>
            <AppButton type="submit" form="create-chatbot-form" loading={mutation.isPending}>
              Create chatbot
            </AppButton>
          </>
        }
      >
        <CreateChatbotForm mutation={mutation} onCreated={() => setOpen(false)} />
      </AppDialog>
    </>
  );
}
