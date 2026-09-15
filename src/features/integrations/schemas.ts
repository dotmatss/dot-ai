import { z } from "zod";

import { CREDENTIAL_RESERVED_HEADERS, CREDENTIAL_TYPE_META } from "@/features/integrations/constants";
import { INTEGRATIONS } from "@/features/integrations/registry";
import {
  CREDENTIAL_TYPES,
  INTEGRATION_PROVIDERS,
  type CredentialType,
  type IntegrationProvider,
} from "@/features/integrations/types";

export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);

/**
 * Wire shape for connecting or reconfiguring a provider.
 *
 * `config` and `secrets` are deliberately loose here: the provider is a path
 * parameter, so the per-provider schema can only be applied once it is known.
 * `connectionSchemaFor()` below does that, on the server for the request body
 * and on the client for the form, from the one registry definition.
 */
export const connectIntegrationSchema = z.object({
  config: z.record(z.string(), z.unknown()).default({}),
  /** Only fields present here are replaced; omitted fields keep their stored value. */
  secrets: z.record(z.string(), z.string().max(4000, { error: "That value is too long" })).default({}),
});

export type ConnectIntegrationInput = z.input<typeof connectIntegrationSchema>;

export interface ConnectionFormValues {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

/**
 * Per-provider validation for a connect request.
 *
 * `configuredSecretFields` is what is already stored: a required secret may be
 * left blank when it is already set (the UI shows "Configured" and a Replace
 * action), but must be supplied the first time.
 */
export function connectionSchemaFor(provider: IntegrationProvider, configuredSecretFields: readonly string[] = []) {
  const definition = INTEGRATIONS[provider];
  const secretShape: Record<string, z.ZodType> = {};
  for (const field of definition.secretFields) {
    const base = z.string().trim().max(4000, { error: "That value is too long" });
    secretShape[field.key] =
      field.required && !configuredSecretFields.includes(field.key)
        ? base.min(1, { error: `Enter the ${field.label.toLowerCase()}` })
        : base.optional();
  }
  return z.object({
    config: definition.configSchema,
    secrets: z.object(secretShape),
  });
}

/**
 * Flattens Zod issues into `{ "config.url": ["..."] }` so the same details
 * object drives both the API error envelope and `applyFieldErrors` on nested
 * React Hook Form paths.
 */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map((part) => String(part)).join(".") || "config";
    const bucket = details[key];
    if (bucket) bucket.push(issue.message);
    else details[key] = [issue.message];
  }
  return details;
}

/* -------------------------------------------------------------------------- */
/* Outbound credentials                                                        */
/* -------------------------------------------------------------------------- */

export const credentialTypeSchema = z.enum(CREDENTIAL_TYPES);

/** RFC 7230 token characters. A header name outside this set is not a header name. */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

export const credentialNameSchema = z
  .string()
  .trim()
  .min(2, { error: "Name the credential so you can recognise it later" })
  .max(60, { error: "Keep the name under 60 characters" });

const customHeaderNameSchema = z
  .string()
  .trim()
  .min(1, { error: "Enter the header name" })
  .max(100, { error: "Keep the header name under 100 characters" })
  .regex(HEADER_NAME_PATTERN, { error: "A header name may only contain letters, digits and !#$%&'*+-.^_`|~" })
  .refine((value) => !CREDENTIAL_RESERVED_HEADERS.includes(value.toLowerCase()), {
    error: "That header is set by the request itself and cannot be overridden",
  });

const secretValueSchema = z.string().max(4000, { error: "That value is too long" });

/**
 * Wire shape for creating a credential. Loose in the same places and for the
 * same reason as `connectIntegrationSchema`: `secrets` cannot be validated
 * until `type` is known, so `credentialSchemaFor()` below does the real work
 * once it is - on the server for the body, on the client for the form.
 */
export const createCredentialSchema = z.object({
  name: credentialNameSchema,
  type: credentialTypeSchema,
  headerName: z.string().trim().max(100).default(""),
  secrets: z.record(z.string(), secretValueSchema).default({}),
});

export type CreateCredentialInput = z.input<typeof createCredentialSchema>;

/**
 * Editing an existing credential.
 *
 * `type` is absent deliberately: it decides which secret fields the envelope
 * holds, so changing it would silently orphan them. Switching kinds is deleting
 * one credential and creating another, which is also the honest description of
 * what it does to anything referencing it.
 */
export const updateCredentialSchema = z.object({
  name: credentialNameSchema.optional(),
  headerName: z.string().trim().max(100).optional(),
  /** Only fields present here are replaced; omitted fields keep their stored value. */
  secrets: z.record(z.string(), secretValueSchema).default({}),
});

export type UpdateCredentialInput = z.input<typeof updateCredentialSchema>;

export interface CredentialFormValues {
  name: string;
  type: CredentialType;
  headerName: string;
  secrets: Record<string, string>;
}

/**
 * Per-kind validation.
 *
 * `secretsRequired` is false when editing something already stored: a blank
 * field then means "keep the stored value", which is how Replace works without
 * ever sending the current secret to the browser.
 */
export function credentialSchemaFor(type: CredentialType, options: { secretsRequired: boolean }) {
  const meta = CREDENTIAL_TYPE_META[type];
  // Typed as a string schema either way, so the parsed `secrets` is
  // `Record<string, string>` in both branches and the form, the route and the
  // service all agree on one shape. Blank is the "keep what is stored" signal.
  const secretShape: Record<string, z.ZodString | z.ZodDefault<z.ZodString>> = {};
  for (const field of meta.secretFields) {
    secretShape[field.key] = options.secretsRequired
      ? secretValueSchema.trim().min(1, { error: `Enter the ${field.label.toLowerCase()}` })
      : secretValueSchema.trim().default("");
  }
  return z.object({
    name: credentialNameSchema,
    // Only the custom-header kind has a header name to give; for the others the
    // scheme decides it, and whatever arrives is ignored rather than stored -
    // accepting one would create a second source of truth.
    headerName: meta.header === null ? customHeaderNameSchema : z.string().trim().max(100).default(""),
    secrets: z.object(secretShape),
  });
}

export const credentialListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: credentialTypeSchema.optional(),
  search: z.string().trim().max(120).optional(),
});
