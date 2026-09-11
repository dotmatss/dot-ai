"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { AppButton } from "@/components/ui/app-button";
import { AppDialog } from "@/components/ui/app-dialog";
import { ContactFormFields } from "@/features/crm/components/contact-form-fields";
import { useUpdateContactMutation } from "@/features/crm/mutations";
import { contactFormSchema, type ContactFormValues } from "@/features/crm/schemas";
import type { Contact } from "@/features/crm/types";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

const FORM_ID = "edit-contact-form";

function toFormValues(contact: Contact): ContactFormValues {
  return {
    name: contact.name ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    company: contact.company ?? "",
    stage: contact.stage,
    tags: contact.tags,
  };
}

function EditContactForm({
  contact,
  mutation,
  onSaved,
}: {
  contact: Contact;
  mutation: ReturnType<typeof useUpdateContactMutation>;
  onSaved: () => void;
}) {
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: toFormValues(contact),
  });
  const { reset, formState } = form;

  // The stage control in the header writes to the same record while this
  // dialog is open. Reconcile with the server copy, but never while the user
  // has unsaved edits - that would silently discard their typing.
  useEffect(() => {
    if (formState.isDirty) return;
    reset(toFormValues(contact));
  }, [contact, reset, formState.isDirty]);

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
        onSuccess: onSaved,
        onError: (error) => {
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

export function EditContactDialog({ contact, open, onClose }: { contact: Contact; open: boolean; onClose: () => void }) {
  const mutation = useUpdateContactMutation(contact.id);
  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Edit contact"
      description="Changes to stage and tags are recorded in the contact's history."
      size="lg"
      dismissible={!mutation.isPending}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </AppButton>
          <AppButton type="submit" form={FORM_ID} loading={mutation.isPending}>
            Save changes
          </AppButton>
        </>
      }
    >
      <EditContactForm contact={contact} mutation={mutation} onSaved={onClose} />
    </AppDialog>
  );
}
