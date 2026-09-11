import "server-only";

import { INTEGRATIONS } from "@/features/integrations/registry";
import { connectionSchemaFor, fieldErrorsFrom, type ConnectIntegrationInput } from "@/features/integrations/schemas";
import {
  clearIntegrationSecret,
  deleteIntegration,
  findIntegrationRecord,
  listIntegrationRecords,
  recordIntegrationTest,
  upsertIntegration,
  upsertIntegrationSecret,
  type IntegrationRecord,
} from "@/features/integrations/server/integration-repository";
import { postTestPayload } from "@/features/integrations/server/connection-test";
import { openSecretMap, sealSecretMap, secretContext, SecretDecryptionError } from "@/features/integrations/server/secret-box";
import type { Integration, IntegrationProvider, IntegrationTestOutcome, IntegrationTestResult } from "@/features/integrations/types";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import { withWorkspace } from "@/server/db/client";

export interface ActorContext {
  workspaceId: string;
  userId: string;
}

/**
 * Business rules for integrations, and the only module allowed to decrypt.
 *
 * Nothing returned from here contains secret material: `toIntegration` reduces
 * the sealed envelope to the list of configured field names, which is what the
 * UI needs to show a "Configured" indicator and a Replace action.
 */

/**
 * Opens the sealed envelope, treating an unreadable one as "no secrets".
 *
 * An envelope that will not open (a rotated APP_SECRET, a row restored from
 * another environment) must not break the page: the credential is reported as
 * missing so an operator can re-enter it, which is the only recovery anyway.
 * The log line carries no ciphertext and no context string.
 */
function openSecrets(record: IntegrationRecord, workspaceId: string): Record<string, string> {
  if (!record.secret) return {};
  try {
    return openSecretMap(record.secret, secretContext(workspaceId, record.provider));
  } catch (error) {
    if (error instanceof SecretDecryptionError) {
      console.error(`[integrations] unreadable secret for provider ${record.provider}`);
      return {};
    }
    throw error;
  }
}

function configuredFieldsOf(record: IntegrationRecord, workspaceId: string): string[] {
  return Object.keys(openSecrets(record, workspaceId));
}

function toIntegration(record: IntegrationRecord, workspaceId: string): Integration {
  return {
    id: record.id,
    provider: record.provider,
    name: record.name,
    status: record.status,
    config: record.config,
    configuredSecretFields: configuredFieldsOf(record, workspaceId),
    lastTest: record.lastTest,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function getIntegrations(workspaceId: string): Promise<Integration[]> {
  const records = await listIntegrationRecords(workspaceId);
  return records.map((record) => toIntegration(record, workspaceId));
}

export async function getIntegration(workspaceId: string, provider: IntegrationProvider): Promise<Integration> {
  const record = await findIntegrationRecord(workspaceId, provider);
  if (!record) throw ApiError.notFound("Integration is not connected");
  return toIntegration(record, workspaceId);
}

/**
 * Creates or reconfigures a connection.
 *
 * Secret fields are write-only: a field the caller omits keeps its stored
 * value, which is how "Replace" works without ever sending the current secret
 * to the browser.
 */
export async function connectIntegration(
  ctx: ActorContext,
  provider: IntegrationProvider,
  input: ConnectIntegrationInput,
): Promise<Integration> {
  const definition = INTEGRATIONS[provider];
  if (definition.status === "coming_soon") {
    throw ApiError.badRequest(`${definition.name} is not available yet`);
  }

  const existing = await findIntegrationRecord(ctx.workspaceId, provider);
  const storedSecrets = existing ? openSecrets(existing, ctx.workspaceId) : {};

  const parsed = connectionSchemaFor(provider, Object.keys(storedSecrets)).safeParse({
    config: input.config ?? {},
    secrets: input.secrets ?? {},
  });
  if (!parsed.success) throw ApiError.validation(fieldErrorsFrom(parsed.error));

  // Merge rather than replace: only the fields the operator actually typed are
  // rewritten, and blank means "keep what is stored".
  const nextSecrets: Record<string, string> = { ...storedSecrets };
  for (const field of definition.secretFields) {
    const value = parsed.data.secrets[field.key];
    if (typeof value === "string" && value.length > 0) nextSecrets[field.key] = value;
  }
  for (const key of Object.keys(nextSecrets)) {
    // Drop anything the registry no longer declares, so a removed field cannot
    // linger in the envelope forever.
    if (!definition.secretFields.some((field) => field.key === key)) delete nextSecrets[key];
  }

  const config = parsed.data.config as Record<string, unknown>;

  const integration = await withWorkspace(ctx.workspaceId, async (client) => {
    const integrationId = await upsertIntegration(
      { workspaceId: ctx.workspaceId, provider, name: definition.name, config, createdBy: ctx.userId },
      client,
    );
    if (Object.keys(nextSecrets).length > 0) {
      await upsertIntegrationSecret(
        ctx.workspaceId,
        integrationId,
        sealSecretMap(nextSecrets, secretContext(ctx.workspaceId, provider)),
        client,
      );
    } else if (existing?.secret) {
      await clearIntegrationSecret(ctx.workspaceId, integrationId, client);
    }

    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "integration",
        entityId: integrationId,
        action: existing ? "updated" : "connected",
        summary: `${existing ? "Reconfigured" : "Connected"} ${definition.name}`,
        // Field names only. Values are never written to the audit trail,
        // because secrets would then live in a second, unencrypted place.
        metadata: { provider, secretFields: Object.keys(nextSecrets) },
      },
      client,
    );

    const saved = await findIntegrationRecord(ctx.workspaceId, provider, client);
    if (!saved) throw new Error("Integration vanished after save");
    return saved;
  });

  return toIntegration(integration, ctx.workspaceId);
}

export async function disconnectIntegration(ctx: ActorContext, provider: IntegrationProvider): Promise<void> {
  const definition = INTEGRATIONS[provider];
  await withWorkspace(ctx.workspaceId, async (client) => {
    const existing = await findIntegrationRecord(ctx.workspaceId, provider, client);
    if (!existing) throw ApiError.notFound("Integration is not connected");
    // The row carries the credential by reference; deleting it cascades to
    // integration_secrets, so disconnecting always destroys the stored secret.
    await deleteIntegration(ctx.workspaceId, provider, client);
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "integration",
        entityId: existing.id,
        action: "disconnected",
        summary: `Disconnected ${definition.name}`,
        metadata: { provider },
      },
      client,
    );
  });
}

/**
 * Sends a test payload from the server and stores the outcome.
 *
 * The destination is resolved here, on the server: for Slack it is the
 * encrypted incoming-webhook URL, which is never sent to a client.
 */
export async function testIntegration(ctx: ActorContext, provider: IntegrationProvider): Promise<IntegrationTestResult> {
  const definition = INTEGRATIONS[provider];
  if (!definition.testable) throw ApiError.badRequest(`${definition.name} has no connection test`);

  const record = await findIntegrationRecord(ctx.workspaceId, provider);
  if (!record) throw ApiError.notFound("Integration is not connected");

  const secrets = openSecrets(record, ctx.workspaceId);
  const payload = {
    event: "integration.test",
    provider,
    workspaceId: ctx.workspaceId,
    sentAt: new Date().toISOString(),
  };

  let delivery: { ok: boolean; message: string };
  if (provider === "slack") {
    const webhookUrl = secrets.webhookUrl;
    if (!webhookUrl) {
      delivery = { ok: false, message: "No incoming webhook URL is stored. Add it again and retry." };
    } else {
      delivery = await postTestPayload({
        url: webhookUrl,
        body: { text: "Test message from dot. Your Slack integration is working." },
        displayName: "Slack",
      });
    }
  } else {
    const url = typeof record.config.url === "string" ? record.config.url : "";
    delivery = url
      ? await postTestPayload({ url, body: payload, signingSecret: secrets.signingSecret })
      : { ok: false, message: "No endpoint URL is configured." };
  }

  const outcome: IntegrationTestOutcome = { ...delivery, checkedAt: new Date().toISOString() };

  const updated = await withWorkspace(ctx.workspaceId, async (client) => {
    await recordIntegrationTest(ctx.workspaceId, record.id, outcome, client);
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "integration",
        entityId: record.id,
        action: outcome.ok ? "test:passed" : "test:failed",
        summary: `Tested ${definition.name}: ${outcome.ok ? "success" : "failed"}`,
        metadata: { provider },
      },
      client,
    );
    const saved = await findIntegrationRecord(ctx.workspaceId, provider, client);
    if (!saved) throw new Error("Integration vanished after test");
    return saved;
  });

  return { ...outcome, integration: toIntegration(updated, ctx.workspaceId) };
}
