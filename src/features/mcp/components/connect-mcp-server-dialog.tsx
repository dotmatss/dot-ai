"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { AppFormField } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton } from "@/components/ui/app-button";
import { AppDialog } from "@/components/ui/app-dialog";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { MCP_AUTH_KIND_META, MCP_DEFAULT_CREDENTIAL_HEADER } from "@/features/mcp/constants";
import { useCreateMcpServerMutation } from "@/features/mcp/mutations";
import { createMcpServerSchema, type CreateMcpServerInput } from "@/features/mcp/schemas";
import { MCP_AUTH_KINDS } from "@/features/mcp/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canManage } from "@/features/workspaces/roles";
import { isApiError } from "@/lib/api/api-error";
import { applyFieldErrors } from "@/lib/forms/apply-field-errors";

const FORM_ID = "connect-mcp-server-form";

type CreateMutation = ReturnType<typeof useCreateMcpServerMutation>;

function ConnectForm({ mutation, onDone }: { mutation: CreateMutation; onDone: () => void }) {
  const form = useForm<CreateMcpServerInput>({
    resolver: zodResolver(createMcpServerSchema),
    defaultValues: { name: "", endpointUrl: "", authKind: "none", credentialHeader: MCP_DEFAULT_CREDENTIAL_HEADER },
  });

  // useWatch rather than form.watch, per the feature conventions.
  const authKind = useWatch({ control: form.control, name: "authKind" });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values, {
      onSuccess: onDone,
      onError: (error) => {
        if (isApiError(error) && error.details) applyFieldErrors(form.setError, error.details);
      },
    });
  });

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AppFormField
        label="Name"
        description="What this server is, in your words. It also becomes the prefix your agents see on its tools."
        error={form.formState.errors.name?.message}
        required
      >
        {(field) => <AppInput {...field} {...form.register("name")} placeholder="Orders MCP" autoFocus />}
      </AppFormField>

      <AppFormField
        label="MCP endpoint"
        description="The server's Streamable HTTP endpoint. Must be https, and must be reachable from the public internet."
        error={form.formState.errors.endpointUrl?.message}
        required
      >
        {(field) => <AppInput {...field} {...form.register("endpointUrl")} placeholder="https://mcp.example.com/mcp" />}
      </AppFormField>

      <AppFormField label="Authentication" error={form.formState.errors.authKind?.message}>
        {(field) => (
          <AppSelect
            {...field}
            {...form.register("authKind")}
            options={MCP_AUTH_KINDS.map((kind) => ({ value: kind, label: MCP_AUTH_KIND_META[kind].label }))}
          />
        )}
      </AppFormField>

      {authKind === "header" ? (
        <>
          <AppFormField
            label="Header name"
            description="Leave as Authorization for a bearer token."
            error={form.formState.errors.credentialHeader?.message}
          >
            {(field) => <AppInput {...field} {...form.register("credentialHeader")} placeholder={MCP_DEFAULT_CREDENTIAL_HEADER} />}
          </AppFormField>

          <AppFormField
            label="Credential"
            description="Encrypted at rest and sent only from our servers. It is never shown again after you save it."
            error={form.formState.errors.credential?.message}
            required
          >
            {(field) => (
              <AppInput
                {...field}
                {...form.register("credential")}
                type="password"
                autoComplete="off"
                placeholder="Bearer token or API key"
              />
            )}
          </AppFormField>
        </>
      ) : null}

      <AppAlert tone="info" title="Nothing is enabled by connecting">
        Connecting a server only lets you see what it offers. Each tool has to be reviewed and approved before any agent can
        use it, and a tool that changes after approval stops being offered until someone looks again.
      </AppAlert>
    </form>
  );
}

/**
 * Connect a remote MCP server.
 *
 * Admin only, because connecting a server is the first half of giving an agent
 * reach into an external system. The credential field is `type="password"`
 * with autocomplete off: it is write-only from the browser's point of view and
 * the API never returns it.
 */
export function ConnectMcpServerButton() {
  const { membership } = useWorkspace();
  const [open, setOpen] = useState(false);
  const mutation = useCreateMcpServerMutation();

  if (!canManage(membership.role)) return null;

  return (
    <>
      <AppButton onClick={() => setOpen(true)} leadingIcon={<Plus aria-hidden />} size="sm">
        Connect MCP server
      </AppButton>
      <AppDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Connect an MCP server"
        description="Streamable HTTP over https. Local and command-launched servers are not supported."
        size="lg"
        dismissible={!mutation.isPending}
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setOpen(false)} disabled={mutation.isPending}>
              Cancel
            </AppButton>
            <AppButton type="submit" form={FORM_ID} loading={mutation.isPending}>
              Connect
            </AppButton>
          </>
        }
      >
        {open ? <ConnectForm mutation={mutation} onDone={() => setOpen(false)} /> : null}
      </AppDialog>
    </>
  );
}
