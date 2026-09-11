"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Upload } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { AppButton } from "@/components/ui/app-button";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppTooltip } from "@/components/ui/app-tooltip";
import { ContactFormFields } from "@/features/crm/components/contact-form-fields";
import { useCreateContactMutation } from "@/features/crm/mutations";
import { contactFormSchema, type ContactFormValues } from "@/features/crm/schemas";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

const FORM_ID = "create-contact-form";

const EMPTY_CONTACT_FORM: ContactFormValues = {
  name: "",
  email: "",
  phone: "",
  company: "",
  stage: "lead",
  tags: [],
};

function CreateContactForm({
  mutation,
  onCreated,
}: {
  mutation: ReturnType<typeof useCreateContactMutation>;
  onCreated: () => void;
}) {
  const router = useRouter();
  const { membership } = useWorkspace();
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: EMPTY_CONTACT_FORM,
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(
      {
        name: values.name || null,
        email: values.email || null,
        phone: values.phone || null,
        company: values.company || null,
        stage: values.stage,
        tags: values.tags,
      },
      {
        onSuccess: (contact) => {
          onCreated();
          router.push(`/w/${membership.workspace.slug}/crm/${contact.id}` as Route);
        },
        onError: (error) => {
          // A duplicate email comes back as a 409 carrying field details, so it
          // lands on the email input rather than only in a toast.
          if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
        },
      },
    );
  });

  return (
    <FormProvider {...form}>
      <form id={FORM_ID} onSubmit={onSubmit} noValidate>
        <ContactFormFields />
      </form>
    </FormProvider>
  );
}

export function CreateContactButton() {
  const [open, setOpen] = useState(false);
  const { membership } = useWorkspace();
  const mutation = useCreateContactMutation();
  if (!canEdit(membership.role)) return null;

  return (
    <>
      <AppButton onClick={() => setOpen(true)} leadingIcon={<Plus aria-hidden />}>
        New contact
      </AppButton>
      <AppDialog
        open={open}
        onClose={() => setOpen(false)}
        title="New contact"
        description="Contacts are identified by email address within this workspace."
        size="lg"
        dismissible={!mutation.isPending}
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancel
            </AppButton>
            <AppButton type="submit" form={FORM_ID} loading={mutation.isPending}>
              Create contact
            </AppButton>
          </>
        }
      >
        <CreateContactForm mutation={mutation} onCreated={() => setOpen(false)} />
      </AppDialog>
    </>
  );
}

/**
 * The import path is not built yet. It is shown as an `aria-disabled` control
 * rather than a native `disabled` one so it stays focusable: a `disabled`
 * button fires neither hover nor focus events, which would leave the tooltip -
 * the only place the "coming soon" explanation lives - unreachable by keyboard.
 */
export function ImportContactsButton() {
  const { membership } = useWorkspace();
  if (!canEdit(membership.role)) return null;
  return (
    <AppTooltip content="CSV import is coming soon">
      <AppButton
        variant="secondary"
        aria-disabled
        onClick={(event) => event.preventDefault()}
        leadingIcon={<Upload aria-hidden />}
        className="cursor-not-allowed opacity-50"
      >
        Import CSV
      </AppButton>
    </AppTooltip>
  );
}
