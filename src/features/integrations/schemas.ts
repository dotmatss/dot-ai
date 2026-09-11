import { z } from "zod";

import { playgroundChatSchema } from "@/features/chatbots/schemas";
import { INTEGRATIONS } from "@/features/integrations/registry";
import { INTEGRATION_PROVIDERS, type IntegrationProvider } from "@/features/integrations/types";

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

export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { error: "Name the key so you can recognise it later" })
    .max(60, { error: "Keep the name under 60 characters" }),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export const apiKeyListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["active", "revoked"]).optional(),
});

/**
 * Body of the public, API-key authenticated chat endpoint. Built on the
 * playground schema so third-party callers and the widget share one contract.
 */
export const publicChatSchema = playgroundChatSchema.extend({
  chatbotId: z.uuid({ error: "chatbotId must be a chatbot UUID" }),
});

export type PublicChatInput = z.infer<typeof publicChatSchema>;
