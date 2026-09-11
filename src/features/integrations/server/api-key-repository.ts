import "server-only";

import type { ApiKey, ApiKeyListFilters } from "@/features/integrations/types";
import { query, queryOne, type Queryable } from "@/server/db/client";
import { normalizePage, ParamBuilder, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  created_by_name: string | null;
}

const SELECT_API_KEY = `
  SELECT k.id, k.name, k.key_prefix, k.last_used_at, k.revoked_at, k.created_at, u.name AS created_by_name
  FROM api_keys k
  LEFT JOIN users u ON u.id = k.created_by
`;

function mapApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    createdAt: toIsoRequired(row.created_at),
    createdByName: row.created_by_name,
    lastUsedAt: toIso(row.last_used_at),
    revokedAt: toIso(row.revoked_at),
  };
}

export async function listApiKeys(workspaceId: string, filters: ApiKeyListFilters): Promise<Paginated<ApiKey>> {
  const page = normalizePage(filters);
  const params = new ParamBuilder();
  const where: string[] = [`k.workspace_id = ${params.add(workspaceId)}`];
  if (filters.status === "active") where.push("k.revoked_at IS NULL");
  if (filters.status === "revoked") where.push("k.revoked_at IS NOT NULL");
  const whereSql = where.join(" AND ");

  const [rows, countRow] = await Promise.all([
    query<ApiKeyRow>(
      `${SELECT_API_KEY} WHERE ${whereSql} ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC
       LIMIT ${params.add(page.pageSize)} OFFSET ${params.add(page.offset)}`,
      params.values,
    ),
    queryOne<{ count: string }>(`SELECT count(*) AS count FROM api_keys k WHERE ${whereSql}`, params.values.slice(0, -2)),
  ]);

  return toPaginated(rows.map(mapApiKey), Number(countRow?.count ?? 0), page);
}

export async function findApiKey(workspaceId: string, apiKeyId: string, client?: Queryable): Promise<ApiKey | null> {
  const row = await queryOne<ApiKeyRow>(`${SELECT_API_KEY} WHERE k.workspace_id = $1 AND k.id = $2`, [workspaceId, apiKeyId], client);
  return row ? mapApiKey(row) : null;
}

export interface InsertApiKeyInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
}

export async function insertApiKey(input: InsertApiKeyInput, client?: Queryable): Promise<ApiKey> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO api_keys (workspace_id, created_by, name, key_prefix, key_hash)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.workspaceId, input.createdBy, input.name, input.keyPrefix, input.keyHash],
    client,
  );
  if (!row) throw new Error("Failed to insert API key");
  const created = await findApiKey(input.workspaceId, row.id, client);
  if (!created) throw new Error("API key vanished after insert");
  return created;
}

/** Revocation is permanent and idempotent: the first revocation timestamp wins. */
export async function revokeApiKeyRow(workspaceId: string, apiKeyId: string, client?: Queryable): Promise<ApiKey | null> {
  const rows = await query<{ id: string }>(
    "UPDATE api_keys SET revoked_at = now() WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL RETURNING id",
    [workspaceId, apiKeyId],
    client,
  );
  if (rows.length === 0) return null;
  return findApiKey(workspaceId, apiKeyId, client);
}

export interface ApiKeyCredentialRow {
  id: string;
  workspaceId: string;
  keyHash: string;
  revokedAt: string | null;
}

/**
 * Looks a key up by hash for the public API.
 *
 * Deliberately not workspace-scoped: the workspace is the *result* of
 * authentication, never an input to it. The unique index on key_hash makes this
 * a single index probe.
 */
export async function findApiKeyCredentialByHash(keyHash: string): Promise<ApiKeyCredentialRow | null> {
  const row = await queryOne<{ id: string; workspace_id: string; key_hash: string; revoked_at: Date | null }>(
    "SELECT id, workspace_id, key_hash, revoked_at FROM api_keys WHERE key_hash = $1",
    [keyHash],
  );
  return row ? { id: row.id, workspaceId: row.workspace_id, keyHash: row.key_hash, revokedAt: toIso(row.revoked_at) } : null;
}

export async function touchApiKeyLastUsed(apiKeyId: string): Promise<void> {
  await query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [apiKeyId]);
}
