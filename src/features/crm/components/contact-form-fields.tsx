"use client";

import { useFormContext, useWatch } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { ContactTagEditor } from "@/features/crm/components/contact-tag-editor";
import { CONTACT_STAGE_META, CONTACT_STAGE_ORDER } from "@/features/crm/constants";
import { useContactTagsQuery } from "@/features/crm/queries";
import type { ContactFormValues } from "@/features/crm/schemas";

const STAGE_OPTIONS = CONTACT_STAGE_ORDER.map((stage) => ({ value: stage, label: CONTACT_STAGE_META[stage].label }));

/**
 * Field set shared by the create and edit dialogs, so the two can never drift
 * apart on validation, labels or ordering.
 */
export function ContactFormFields() {
  const form = useFormContext<ContactFormValues>();
  const tagsQuery = useContactTagsQuery();
  const stage = useWatch({ control: form.control, name: "stage" });
  const tags = useWatch({ control: form.control, name: "tags" }) ?? [];
  const errors = form.formState.errors;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <AppFormField
          label="Name"
          description="A name or an email address is required."
          error={errors.name?.message}
        >
          {(field) => <AppInput {...field} {...form.register("name")} placeholder="Ada Lovelace" autoComplete="off" autoFocus />}
        </AppFormField>
        <AppFormField label="Email" error={errors.email?.message}>
          {(field) => <AppInput {...field} {...form.register("email")} type="email" placeholder="ada@example.com" autoComplete="off" />}
        </AppFormField>
        <AppFormField label="Phone" optional error={errors.phone?.message}>
          {(field) => <AppInput {...field} {...form.register("phone")} type="tel" placeholder="+1 555 0100" autoComplete="off" />}
        </AppFormField>
        <AppFormField label="Company" optional error={errors.company?.message}>
          {(field) => <AppInput {...field} {...form.register("company")} placeholder="Acme" autoComplete="off" />}
        </AppFormField>
      </div>

      <AppFormField label="Stage" description={CONTACT_STAGE_META[stage].description} error={errors.stage?.message}>
        {(field) => <AppSelect {...field} {...form.register("stage")} options={STAGE_OPTIONS} />}
      </AppFormField>

      <AppFormField
        label="Tags"
        optional
        description="Lowercase labels used to segment contacts. Press Enter to add."
        error={errors.tags?.message}
      >
        {(field) => (
          <ContactTagEditor
            inputId={field.id}
            describedBy={field["aria-describedby"]}
            invalid={field["aria-invalid"]}
            value={tags}
            suggestions={(tagsQuery.data ?? []).map((item) => item.tag)}
            onChange={(next) => form.setValue("tags", next, { shouldDirty: true, shouldValidate: true })}
          />
        )}
      </AppFormField>
    </div>
  );
}
