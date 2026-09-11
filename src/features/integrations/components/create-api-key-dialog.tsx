"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { AppCodeBlock } from "@/components/ui/app-code-block";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppInput } from "@/components/ui/app-input";
import { AppText } from "@/components/ui/app-typography";
import { useCreateApiKeyMutation } from "@/features/integrations/mutations";
import { createApiKeySchema, type CreateApiKeyInput } from "@/features/integrations/schemas";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

const FORM_ID = "create-api-key-form";

type CreateMutation = ReturnType<typeof useCreateApiKeyMutation>;

function CreateApiKeyForm({ mutation, onCreated }: { mutation: CreateMutation; onCreated: (secret: string) => void }) {
  const form = useForm<CreateApiKeyInput>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: { name: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values, {
      onSuccess: (result) => onCreated(result.secret),
      onError: (error) => {
        if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
      },
    });
  });

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AppFormField
        label="Name"
        description="Name the system that will use this key, so you know what a revocation would break."
        error={form.formState.errors.name?.message}
        required
      >
        {(field) => <AppInput {...field} {...form.register("name")} placeholder="Zapier production" autoFocus />}
      </AppFormField>
    </form>
  );
}

/**
 * The plaintext key exists in this component's state for one dialog session and
 * is never persisted, re-fetched or logged: the server stores only its hash, so
 * this really is the only chance to copy it.
 */
function RevealedKey({ secret }: { secret: string }) {
  return (
    <div className="flex flex-col gap-4">
      <AppAlert tone="warning" title="Copy this key now">
        <AppText size="sm" tone="secondary">
          It is shown once. We store only a hash, so it cannot be recovered - if you lose it, revoke the key and create
          another.
        </AppText>
      </AppAlert>
      <AppCodeBlock code={secret} label="API key" />
      <AppText size="sm" tone="muted">
        Treat it like a password: it grants access to this workspace through the public API. Send it in an
        Authorization header, never in a URL or a browser bundle.
      </AppText>
    </div>
  );
}

export function CreateApiKeyButton({ size }: { size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const { membership } = useWorkspace();
  const mutation = useCreateApiKeyMutation();

  // Creating a key grants API access to the whole workspace; the server
  // enforces the same rule, this only keeps the affordance honest.
  if (!canManage(membership.role)) return null;

  function close() {
    setOpen(false);
    // Drop the plaintext as soon as the dialog closes.
    setSecret(null);
    mutation.reset();
  }

  return (
    <>
      <AppButton onClick={() => setOpen(true)} leadingIcon={<Plus aria-hidden />} size={size}>
        Create API key
      </AppButton>
      <AppDialog
        open={open}
        onClose={close}
        title={secret ? "API key created" : "Create API key"}
        description={secret ? undefined : "Keys authenticate server-to-server calls to the public API."}
        dismissible={!mutation.isPending}
        footer={
          secret ? (
            <AppButton onClick={close}>Done</AppButton>
          ) : (
            <>
              <AppButton variant="secondary" onClick={close} disabled={mutation.isPending}>
                Cancel
              </AppButton>
              <AppButton type="submit" form={FORM_ID} loading={mutation.isPending}>
                Create key
              </AppButton>
            </>
          )
        }
      >
        {secret ? <RevealedKey secret={secret} /> : <CreateApiKeyForm mutation={mutation} onCreated={setSecret} />}
      </AppDialog>
    </>
  );
}
