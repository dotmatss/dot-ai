"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { AppText } from "@/components/ui/app-typography";
import { CREDENTIAL_TYPE_META } from "@/features/integrations/constants";
import { useCreateCredentialMutation, useUpdateCredentialMutation } from "@/features/integrations/mutations";
import { credentialSchemaFor, credentialTypeSchema, type CredentialFormValues } from "@/features/integrations/schemas";
import { CREDENTIAL_TYPES, type Credential } from "@/features/integrations/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

const FORM_ID = "credential-form";

const TYPE_OPTIONS = CREDENTIAL_TYPES.map((type) => ({ value: type, label: CREDENTIAL_TYPE_META[type].label }));

/**
 * One form for creating and for editing.
 *
 * The difference between the two is entirely in `secretsRequired`: a new
 * credential must carry every value, an existing one accepts blanks meaning
 * "keep what is stored". The form is never populated with a stored secret,
 * because no endpoint returns one - which is also why editing cannot show you
 * what is currently set, only replace it.
 */
function CredentialForm({
  credential,
  onDone,
}: {
  credential: Credential | null;
  onDone: () => void;
}) {
  const createMutation = useCreateCredentialMutation();
  const updateMutation = useUpdateCredentialMutation();
  const editing = credential !== null;

  /**
   * Built per submit rather than fixed up front: which secret fields are
   * required depends on the kind chosen in the form, and on whether this is a
   * new credential or an edit (where blank means "keep the stored value").
   *
   * The cast is the price of that. A schema constructed at call time cannot
   * have the form's static type, and `credentialSchemaFor` produces exactly the
   * shape `CredentialFormValues` declares - `credentials-schemas.test.ts` pins
   * the two together so this stays true.
   */
  const resolver: Resolver<CredentialFormValues> = (values, context, options) => {
    const schema = credentialSchemaFor(values.type, { secretsRequired: !editing }).extend({ type: credentialTypeSchema });
    return (zodResolver(schema) as unknown as Resolver<CredentialFormValues>)(values, context, options);
  };

  const form = useForm<CredentialFormValues>({
    defaultValues: {
      name: credential?.name ?? "",
      type: credential?.type ?? "bearer",
      // On an existing custom-header credential the header name is not secret,
      // so it comes back from the list and can be shown as the current value.
      headerName: credential?.type === "header" ? credential.headerPreview : "",
      secrets: {},
    },
    resolver,
  });

  // `useWatch` rather than `form.watch`: it subscribes this component to one
  // field instead of re-rendering the form on every keystroke anywhere in it.
  const type = useWatch({ control: form.control, name: "type" }) ?? "bearer";
  const meta = CREDENTIAL_TYPE_META[type];

  useEffect(() => {
    // Each kind declares its own secret fields, so values typed under the
    // previous kind are not just unused - they would be validated against
    // field names that no longer exist.
    if (!editing) form.setValue("secrets", {}, { shouldValidate: false });
  }, [type, editing, form]);

  const mutation = editing ? updateMutation : createMutation;

  const onSubmit = form.handleSubmit((values) => {
    const secrets = Object.fromEntries(
      Object.entries(values.secrets ?? {}).filter(([, value]) => typeof value === "string" && value.length > 0),
    );
    const onError = (error: unknown) => {
      if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
    };

    if (editing) {
      updateMutation.mutate(
        {
          credentialId: credential.id,
          input: { name: values.name, headerName: meta.header === null ? values.headerName : undefined, secrets },
        },
        { onSuccess: onDone, onError },
      );
      return;
    }
    createMutation.mutate(
      { name: values.name, type: values.type, headerName: meta.header === null ? values.headerName : "", secrets },
      { onSuccess: onDone, onError },
    );
  });

  const secretErrors = form.formState.errors.secrets as Record<string, { message?: string }> | undefined;

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AppFormField
        label="Name"
        description="Name the service this authenticates to, so a workflow author can pick it without guessing."
        error={form.formState.errors.name?.message}
        required
      >
        {(field) => <AppInput {...field} {...form.register("name")} placeholder="Stripe (production)" autoFocus />}
      </AppFormField>

      <AppFormField label="Type" description={meta.description} error={form.formState.errors.type?.message} required>
        {(field) => (
          <AppSelect
            {...field}
            options={TYPE_OPTIONS}
            // Immutable after creation: the type decides which values the sealed
            // envelope holds, so changing it would orphan them.
            disabled={editing}
            {...form.register("type")}
          />
        )}
      </AppFormField>

      {meta.header === null ? (
        <AppFormField
          label="Header name"
          description="The header this credential sets on the request."
          error={form.formState.errors.headerName?.message}
          required
        >
          {(field) => <AppInput {...field} {...form.register("headerName")} placeholder="X-API-Key" />}
        </AppFormField>
      ) : (
        <AppText size="sm" tone="muted">
          Sets the <code className="font-mono text-xs">{meta.header}</code> header.
        </AppText>
      )}

      {editing ? (
        <AppAlert tone="info" title="Values are write-only">
          <AppText size="sm" tone="secondary">
            We never send a stored value back to the browser, so it cannot be shown here. Leave a field blank to keep it,
            or type a new value to replace it.
          </AppText>
        </AppAlert>
      ) : null}

      {meta.secretFields.map((field) => (
        <AppFormField
          key={field.key}
          label={field.label}
          error={secretErrors?.[field.key]?.message}
          required={!editing}
        >
          {(aria) => (
            <AppInput
              {...aria}
              {...form.register(`secrets.${field.key}` as const)}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={editing ? "Leave blank to keep the stored value" : field.placeholder}
            />
          )}
        </AppFormField>
      ))}

      {mutation.isError && !isApiError(mutation.error) ? (
        <AppAlert tone="danger" title="Could not save">
          <AppText size="sm" tone="secondary">
            Please try again.
          </AppText>
        </AppAlert>
      ) : null}
    </form>
  );
}

export function CredentialDialog({
  open,
  credential,
  onClose,
}: {
  open: boolean;
  credential: Credential | null;
  onClose: () => void;
}) {
  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={credential ? `Edit “${credential.name}”` : "Add credential"}
      description={
        credential
          ? undefined
          : "Stored encrypted for this workspace and attached by the server when a workflow step runs."
      }
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose}>
            Cancel
          </AppButton>
          <AppButton type="submit" form={FORM_ID}>
            {credential ? "Save changes" : "Add credential"}
          </AppButton>
        </>
      }
    >
      {/* Keyed so switching between rows - or between add and edit - starts a
          fresh form rather than carrying the previous credential's draft. */}
      {open ? <CredentialForm key={credential?.id ?? "new"} credential={credential} onDone={onClose} /> : null}
    </AppDialog>
  );
}

export function AddCredentialButton({ size }: { size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const { membership } = useWorkspace();

  // Storing a credential lets any workflow in the workspace act as this
  // workspace against a third party. The server enforces the same rule.
  if (!canManage(membership.role)) return null;

  return (
    <>
      <AppButton onClick={() => setOpen(true)} leadingIcon={<Plus aria-hidden />} size={size}>
        Add credential
      </AppButton>
      <CredentialDialog open={open} credential={null} onClose={() => setOpen(false)} />
    </>
  );
}

/** Kept out of the panel so the table row only has to own which credential is being edited. */
export function useCredentialDialog() {
  const [editing, setEditing] = useState<Credential | null>(null);
  const [open, setOpen] = useState(false);
  return useMemo(
    () => ({
      editing,
      open,
      edit: (credential: Credential) => {
        setEditing(credential);
        setOpen(true);
      },
      close: () => {
        setOpen(false);
        setEditing(null);
      },
    }),
    [editing, open],
  );
}
