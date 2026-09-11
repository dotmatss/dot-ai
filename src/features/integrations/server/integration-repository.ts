import "server-only";

import { isIntegrationProvider } from "@/features/integrations/registry";
import type { IntegrationProvider, IntegrationStatus, IntegrationTestOutcome } from "@/features/integrations/types";
import type { SealedSecret } from "@/features/integrations/server/secret-box";
import { query, queryOne, type Queryable } from "@/server/db/client";
import { toIso, toIsoRequired } from "@/server/db/sql";

/**
 * SQL for integrations and their sealed credentials.
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
  config: Record<string, unknown> | null;
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
  last_test_at: Date | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_INTEGRATION = `
  SELECT i.id, i.provider, i.name, i.status, i.config,
         i.last_test_at, i.last_test_ok, i.last_test_message, i.created_at, i.updated_at,
         s.ciphertext, s.iv, s.tag
  FROM integrations i
  LEFT JOIN integration_secrets s ON s.integration_id = i.id AND s.workspace_id = i.workspace_id
`;

function mapIntegration(row: IntegrationRow): IntegrationRecord | null {
  // A provider that is no longer in the registry (a rolled-back release, a
  // hand-edited row) has no schema to validate against, so it is not surfaced.
  if (!isIntegrationProvider(row.provider)) return null;
  const lastTestAt = toIso(row.last_test_at);
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    status: row.status,
    config: row.config ?? {},
    secret:
      row.ciphertext && row.iv && row.tag ? { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag } : null,
    lastTest:
      lastTestAt !== null && row.last_test_ok !== null
        ? { ok: row.last_test_ok, message: row.last_test_message ?? "", checkedAt: lastTestAt }
        : null,
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
  };
}

export async function listIntegrationRecords(workspaceId: string, client?: Queryable): Promise<IntegrationRecord[]> {
  const rows = await query<IntegrationRow>(`${SELECT_INTEGRATION} WHERE i.workspace_id = $1 ORDER BY i.created_at`, [workspaceId], client);
  return rows.map(mapIntegration).filter((record): record is IntegrationRecord => record !== null);
}

export async function findIntegrationRecord(
  workspaceId: string,
  provider: IntegrationProvider,
  client?: Queryable,
): Promise<IntegrationRecord | null> {
  const row = await queryOne<IntegrationRow>(
    `${SELECT_INTEGRATION} WHERE i.workspace_id = $1 AND i.provider = $2`,
    [workspaceId, provider],
    client,
  );
  return row ? mapIntegration(row) : null;
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
export async function upsertIntegration(input: UpsertIntegrationInput, client: Queryable): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO integrations (workspace_id, provider, name, status, config, created_by)
     VALUES ($1, $2, $3, 'connected', $4, $5)
     ON CONFLICT (workspace_id, provider) DO UPDATE
       SET name = EXCLUDED.name,
           config = EXCLUDED.config,
           status = 'connected',
           last_test_at = NULL,
           last_test_ok = NULL,
           last_test_message = NULL
     RETURNING id`,
    [input.workspaceId, input.provider, input.name, JSON.stringify(input.config), input.createdBy],
    client,
  );
  if (!row) throw new Error("Failed to upsert integration");
  return row.id;
}

/** Writes the sealed envelope and points `integrations.secret_ref` at it. */
export async function upsertIntegrationSecret(
  workspaceId: string,
  integrationId: string,
  sealed: SealedSecret,
  client: Queryable,
): Promise<void> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO integration_secrets (workspace_id, integration_id, ciphertext, iv, tag)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (integration_id) DO UPDATE
       SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, tag = EXCLUDED.tag
     RETURNING id`,
    [workspaceId, integrationId, sealed.ciphertext, sealed.iv, sealed.tag],
    client,
  );
  if (!row) throw new Error("Failed to store integration secret");
  await query("UPDATE integrations SET secret_ref = $1 WHERE workspace_id = $2 AND id = $3", [row.id, workspaceId, integrationId], client);
}

export async function clearIntegrationSecret(workspaceId: string, integrationId: string, client: Queryable): Promise<void> {
  await query("DELETE FROM integration_secrets WHERE workspace_id = $1 AND integration_id = $2", [workspaceId, integrationId], client);
  await query("UPDATE integrations SET secret_ref = NULL WHERE workspace_id = $1 AND id = $2", [workspaceId, integrationId], client);
}

export async function recordIntegrationTest(
  workspaceId: string,
  integrationId: string,
  outcome: IntegrationTestOutcome,
  client?: Queryable,
): Promise<void> {
  await query(
    `UPDATE integrations
     SET status = $1, last_test_at = $2, last_test_ok = $3, last_test_message = $4
     WHERE workspace_id = $5 AND id = $6`,
    [outcome.ok ? "connected" : "error", outcome.checkedAt, outcome.ok, outcome.message, workspaceId, integrationId],
    client,
  );
}

/** Removes the connection; the sealed secret goes with it through ON DELETE CASCADE. */
export async function deleteIntegration(workspaceId: string, provider: IntegrationProvider, client?: Queryable): Promise<boolean> {
  const rows = await query<{ id: string }>(
    "DELETE FROM integrations WHERE workspace_id = $1 AND provider = $2 RETURNING id",
    [workspaceId, provider],
    client,
  );
  return rows.length > 0;
}
