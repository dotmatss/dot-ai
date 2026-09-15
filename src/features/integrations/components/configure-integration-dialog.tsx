"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, KeyRound } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch, type FieldErrors, type Resolver } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { AppCheckbox } from "@/components/ui/app-checkbox";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppInput, AppPasswordInput } from "@/components/ui/app-input";
import { AppText } from "@/components/ui/app-typography";
import { useConnectIntegrationMutation } from "@/features/integrations/mutations";
import type { IntegrationConfigField, IntegrationDefinition } from "@/features/integrations/registry";
import { connectionSchemaFor, type ConnectionFormValues } from "@/features/integrations/schemas";
import type { Integration } from "@/features/integrations/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

const FORM_ID = "configure-integration-form";

/**
 * The configuration form is generated from the provider's registry entry: the
 * Zod schema validates, the field descriptors decide how each value is
 * presented, and every declared secret becomes a password input that is only
 * ever written, never read back.
 */

function groupErrors(
  errors: FieldErrors<ConnectionFormValues>,
  group: "config" | "secrets",
): Record<string, { message?: string } | undefined> {
  return (errors[group] ?? {}) as Record<string, { message?: string } | undefined>;
}

function defaultValuesFor(definition: IntegrationDefinition, integration: Integration | null): ConnectionFormValues {
  const config: Record<string, unknown> = { ...definition.defaultConfig, ...(integration?.config ?? {}) };
  const secrets: Record<string, string> = {};
  for (const field of definition.secretFields) secrets[field.key] = "";
  return { config, secrets };
}

function ConfigControl({
  field,
  form,
  controlProps,
}: {
  field: IntegrationConfigField;
  form: ReturnType<typeof useForm<ConnectionFormValues>>;
  controlProps: { id: string; "aria-describedby"?: string; "aria-invalid"?: true; "aria-required"?: true };
}) {
  const path = `config.${field.key}` as const;
  const selected = useWatch({ control: form.control, name: path });

  if (field.kind === "checkbox-group") {
    const values = Array.isArray(selected) ? (selected as string[]) : [];
    return (
      // A group of checkboxes is not a labelable control, so the field label is
      // repeated as the group's accessible name rather than relying on htmlFor.
      <div
        role="group"
        id={controlProps.id}
        aria-label={field.label}
        aria-describedby={controlProps["aria-describedby"]}
        className="flex flex-col gap-2 pt-1"
      >
        {(field.options ?? []).map((option) => (
          <AppCheckbox
            key={option.value}
            id={`${controlProps.id}-${option.value}`}
            label={option.label}
            checked={values.includes(option.value)}
            onChange={(event) => {
              const next = event.target.checked
                ? [...values, option.value]
                : values.filter((value) => value !== option.value);
              form.setValue(path, next, { shouldDirty: true, shouldValidate: true });
            }}
          />
        ))}
      </div>
    );
  }

  if (field.kind === "number") {
    return (
      <AppInput
        {...controlProps}
        type="number"
        inputMode="numeric"
        min={field.min}
        max={field.max}
        {...form.register(path, { valueAsNumber: true })}
      />
    );
  }

  return (
    <AppInput
      {...controlProps}
      type={field.kind === "url" ? "url" : "text"}
      placeholder={field.placeholder}
      {...form.register(path)}
    />
  );
}

function SecretControl({
  fieldKey,
  label,
  configured,
  controlProps,
  placeholder,
  register,
}: {
  fieldKey: string;
  label: string;
  configured: boolean;
  controlProps: { id: string; "aria-describedby"?: string; "aria-invalid"?: true; "aria-required"?: true };
  placeholder?: string;
  register: ReturnType<typeof useForm<ConnectionFormValues>>["register"];
}) {
  // A stored secret is never sent to the browser, so the control shows that one
  // exists and stays untouched until the operator explicitly replaces it.
  const [replacing, setReplacing] = useState(!configured);

  if (configured && !replacing) {
    return (
      <div id={controlProps.id} className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary">
          <CircleCheck aria-hidden className="size-4 text-success" />
          Configured
        </span>
        <AppButton variant="secondary" size="sm" onClick={() => setReplacing(true)} aria-label={`Replace ${label}`}>
          Replace
        </AppButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <AppPasswordInput
        {...controlProps}
        autoComplete="off"
        placeholder={placeholder}
        {...register(`secrets.${fieldKey}` as const)}
      />
      {configured ? (
        <button
          type="button"
          onClick={() => setReplacing(false)}
          className="w-fit text-xs font-medium text-foreground-muted underline underline-offset-4 hover:text-foreground focus-ring rounded-xs"
        >
          Keep the stored value
        </button>
      ) : null}
    </div>
  );
}

function ConfigureForm({
  definition,
  integration,
  mutation,
  onSaved,
}: {
  definition: IntegrationDefinition;
  integration: Integration | null;
  mutation: ReturnType<typeof useConnectIntegrationMutation>;
  onSaved: () => void;
}) {
  const { membership } = useWorkspace();
  const configuredSecrets = useMemo(() => integration?.configuredSecretFields ?? [], [integration]);
  const schema = useMemo(() => connectionSchemaFor(definition.id, configuredSecrets), [definition.id, configuredSecrets]);
  const defaults = useMemo(() => defaultValuesFor(definition, integration), [definition, integration]);

  const form = useForm<ConnectionFormValues>({
    // The schema is chosen per provider at runtime, so its static shape cannot
    // describe every provider; the form value type is the contract instead.
    resolver: zodResolver(schema) as unknown as Resolver<ConnectionFormValues>,
    defaultValues: defaults,
  });

  const { reset, formState } = form;
  const integrationId = integration?.id ?? null;
  useEffect(() => {
    // Reconcile with a server change (another admin saved) only while the
    // operator has no unsaved edits, so typing is never discarded.
    if (!formState.isDirty) reset(defaults);
  }, [integrationId, defaults, formState.isDirty, reset]);

  const configErrors = groupErrors(form.formState.errors, "config");
  const secretErrors = groupErrors(form.formState.errors, "secrets");

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(
      { config: values.config, secrets: values.secrets },
      {
        onSuccess: () => onSaved(),
        onError: (error) => {
          if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
        },
      },
    );
  });

  const hasFields = definition.configFields.length > 0 || definition.secretFields.length > 0;

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {definition.id === "zapier" ? (
        <AppAlert tone="info" title="Zapier authenticates with an API key">
          <AppText size="sm" tone="secondary">
            Create a workspace API key and paste it into the Zapier connection. Connecting here only records that you use
            Zapier.
          </AppText>
          <Link
            href={`/w/${membership.workspace.slug}/developer` as Route}
            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 focus-ring rounded-xs"
          >
            <KeyRound aria-hidden className="size-4" />
            Manage API keys
          </Link>
        </AppAlert>
      ) : null}

      {definition.configFields.map((field) => (
        <AppFormField
          key={field.key}
          label={field.label}
          description={field.description}
          required={field.required}
          error={configErrors[field.key]?.message}
        >
          {(controlProps) => <ConfigControl field={field} form={form} controlProps={controlProps} />}
        </AppFormField>
      ))}

      {definition.secretFields.map((field) => (
        <AppFormField
          key={field.key}
          label={field.label}
          description={field.description}
          required={field.required}
          error={secretErrors[field.key]?.message}
        >
          {(controlProps) => (
            <SecretControl
              fieldKey={field.key}
              label={field.label}
              placeholder={field.placeholder}
              configured={configuredSecrets.includes(field.key)}
              controlProps={controlProps}
              register={form.register}
            />
          )}
        </AppFormField>
      ))}

      {!hasFields && definition.id !== "zapier" ? (
        <AppText size="sm" tone="secondary">
          There is nothing to configure. Connecting records that this workspace uses {definition.name}.
        </AppText>
      ) : null}
    </form>
  );
}

export function ConfigureIntegrationDialog({
  definition,
  integration,
  open,
  onClose,
}: {
  definition: IntegrationDefinition;
  integration: Integration | null;
  open: boolean;
  onClose: () => void;
}) {
  const mutation = useConnectIntegrationMutation(definition.id);

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={integration ? `Configure ${definition.name}` : `Connect ${definition.name}`}
      description={definition.description}
      dismissible={!mutation.isPending}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </AppButton>
          <AppButton type="submit" form={FORM_ID} loading={mutation.isPending}>
            {integration ? "Save changes" : "Connect"}
          </AppButton>
        </>
      }
    >
      {open ? (
        <ConfigureForm
          key={definition.id}
          definition={definition}
          integration={integration}
          mutation={mutation}
          onSaved={onClose}
        />
      ) : null}
    </AppDialog>
  );
}
