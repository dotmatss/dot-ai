import "server-only";

import { and, eq } from "drizzle-orm";

import { isIntegrationProvider } from "@/features/integrations/registry";
import type { IntegrationProvider, IntegrationStatus, IntegrationTestOutcome } from "@/features/integrations/types";
import type { SealedSecret } from "@/features/integrations/server/secret-box";
import { withDb, type DatabaseClient } from "@/server/db/client";
import { integrations, integrationSecrets } from "@/server/db/schema";
import { toIso, toIsoRequired } from "@/server/db/sql";

/**
 * Persistence for integrations and their sealed credentials.
 *
 * The record type returned here is server-only: it carries the encrypted
 * envelope. The service maps it to the client-safe `Integration`, which is the
 * only shape that ever reaches a route handler's response.
 */

export interface IntegrationRecord {
  id: string;
  provider: IntegrationProvider;
  name: string;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  secret: SealedSecret | null;
  lastTest: IntegrationTestOutcome | null;
  createdAt: string;
  updatedAt: string;
}

interface IntegrationRow {
  id: string;
  provider: string;
  name: string;
  status: IntegrationStatus;
  config: unknown;
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The sealed envelope is joined on BOTH integration id and workspace id, so a
 * mislinked secret row could not be read across the tenant boundary even
 * before Row Level Security is considered.
 */
const integrationSelection = {
  id: integrations.id,
  provider: integrations.provider,
  name: integrations.name,
  status: integrations.status,
  config: integrations.config,
  lastTestAt: integrations.lastTestAt,
  lastTestOk: integrations.lastTestOk,
  lastTestMessage: integrations.lastTestMessage,
  createdAt: integrations.createdAt,
  updatedAt: integrations.updatedAt,
  ciphertext: integrationSecrets.ciphertext,
  iv: integrationSecrets.iv,
  tag: integrationSecrets.tag,
};

const secretJoin = and(
  eq(integrationSecrets.integrationId, integrations.id),
  eq(integrationSecrets.workspaceId, integrations.workspaceId),
);

function mapIntegration(row: IntegrationRow): IntegrationRecord | null {
  // A provider that is no longer in the registry (a rolled-back release, a
  // hand-edited row) has no schema to validate against, so it is not surfaced.
  if (!isIntegrationProvider(row.provider)) return null;
  const lastTestAt = toIso(row.lastTestAt);
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    status: row.status,
    config: (row.config ?? {}) as Record<string, unknown>,
    secret: row.ciphertext && row.iv && row.tag ? { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag } : null,
    lastTest:
      lastTestAt !== null && row.lastTestOk !== null
        ? { ok: row.lastTestOk, message: row.lastTestMessage ?? "", checkedAt: lastTestAt }
        : null,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

export async function listIntegrationRecords(workspaceId: string, client?: DatabaseClient): Promise<IntegrationRecord[]> {
  const rows = await withDb(
    (db) =>
      db
        .select(integrationSelection)
        .from(integrations)
        .leftJoin(integrationSecrets, secretJoin)
        .where(eq(integrations.workspaceId, workspaceId))
        .orderBy(integrations.createdAt),
    client,
  );
  return rows.map(mapIntegration).filter((record): record is IntegrationRecord => record !== null);
}

export async function findIntegrationRecord(
  workspaceId: string,
  provider: IntegrationProvider,
  client?: DatabaseClient,
): Promise<IntegrationRecord | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(integrationSelection)
        .from(integrations)
        .leftJoin(integrationSecrets, secretJoin)
        .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, provider)))
        .limit(1),
    client,
  );
  return rows[0] ? mapIntegration(rows[0]) : null;
}

export interface UpsertIntegrationInput {
  workspaceId: string;
  provider: IntegrationProvider;
  name: string;
  config: Record<string, unknown>;
  createdBy: string;
}

/**
 * Creates or reconfigures the workspace's row for a provider. A saved
 * configuration always lands as `connected`, and the previous test result is
 * cleared because it no longer describes this configuration.
 */
export async function upsertIntegration(input: UpsertIntegrationInput, client: DatabaseClient): Promise<string> {
  const rows = await withDb(
    (db) =>
      db
        .insert(integrations)
        .values({
          workspaceId: input.workspaceId,
          provider: input.provider,
          name: input.name,
          status: "connected",
          config: input.config,
          createdBy: input.createdBy,
        })
        .onConflictDoUpdate({
          target: [integrations.workspaceId, integrations.provider],
          set: {
            name: input.name,
            config: input.config,
            status: "connected",
            lastTestAt: null,
            lastTestOk: null,
            lastTestMessage: null,
          },
        })
        .returning({ id: integrations.id }),
    client,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Failed to upsert integration");
  return id;
}

/** Writes the sealed envelope and points `integrations.secret_ref` at it. */
export async function upsertIntegrationSecret(
  workspaceId: string,
  integrationId: string,
  sealed: SealedSecret,
  client: DatabaseClient,
): Promise<void> {
  const rows = await withDb(
    (db) =>
      db
        .insert(integrationSecrets)
        .values({
          workspaceId,
          integrationId,
          ciphertext: sealed.ciphertext,
          iv: sealed.iv,
          tag: sealed.tag,
        })
        .onConflictDoUpdate({
          target: integrationSecrets.integrationId,
          set: { ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag },
        })
        .returning({ id: integrationSecrets.id }),
    client,
  );
  const secretId = rows[0]?.id;
  if (!secretId) throw new Error("Failed to store integration secret");
  await withDb(
    (db) =>
      db
        .update(integrations)
        .set({ secretRef: secretId })
        .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.id, integrationId))),
    client,
  );
}

export async function clearIntegrationSecret(workspaceId: string, integrationId: string, client: DatabaseClient): Promise<void> {
  await withDb(
    (db) =>
      db
        .delete(integrationSecrets)
        .where(and(eq(integrationSecrets.workspaceId, workspaceId), eq(integrationSecrets.integrationId, integrationId))),
    client,
  );
  await withDb(
    (db) =>
      db
        .update(integrations)
        .set({ secretRef: null })
        .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.id, integrationId))),
    client,
  );
}

export async function recordIntegrationTest(
  workspaceId: string,
  integrationId: string,
  outcome: IntegrationTestOutcome,
  client?: DatabaseClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(integrations)
        .set({
          status: outcome.ok ? "connected" : "error",
          lastTestAt: new Date(outcome.checkedAt),
          lastTestOk: outcome.ok,
          lastTestMessage: outcome.message,
        })
        .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.id, integrationId))),
    client,
  );
}

/** Removes the connection; the sealed secret goes with it through ON DELETE CASCADE. */
export async function deleteIntegration(
  workspaceId: string,
  provider: IntegrationProvider,
  client?: DatabaseClient,
): Promise<boolean> {
  const rows = await withDb(
    (db) =>
      db
        .delete(integrations)
        .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, provider)))
        .returning({ id: integrations.id }),
    client,
  );
  return rows.length > 0;
}
