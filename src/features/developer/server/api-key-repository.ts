import "server-only";

import { and, asc, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { PoolClient } from "pg";

import type { ApiKey, ApiKeyListFilters } from "@/features/developer/types";
import { withDb } from "@/server/db/client";
import { apiKeys, organizations, users, workspaces } from "@/server/db/schema";
import { normalizePage, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

const apiKeySelection = {
  id: apiKeys.id,
  name: apiKeys.name,
  keyPrefix: apiKeys.keyPrefix,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt,
  createdAt: apiKeys.createdAt,
  createdByName: users.name,
};

function mapApiKey(row: {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  createdByName: string | null;
}): ApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    createdAt: toIsoRequired(row.createdAt),
    createdByName: row.createdByName,
    lastUsedAt: toIso(row.lastUsedAt),
    revokedAt: toIso(row.revokedAt),
  };
}

export async function listApiKeys(workspaceId: string, filters: ApiKeyListFilters): Promise<Paginated<ApiKey>> {
  const page = normalizePage(filters);
  const where = and(
    eq(apiKeys.workspaceId, workspaceId),
    filters.status === "active" ? isNull(apiKeys.revokedAt) : undefined,
    filters.status === "revoked" ? isNotNull(apiKeys.revokedAt) : undefined,
  );

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db
        .select(apiKeySelection)
        .from(apiKeys)
        .leftJoin(users, eq(users.id, apiKeys.createdBy))
        .where(where)
        // PostgreSQL sorts false before true, preserving active keys first.
        .orderBy(asc(sql<boolean>`${apiKeys.revokedAt} IS NOT NULL`), desc(apiKeys.createdAt))
        .limit(page.pageSize)
        .offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(apiKeys).where(where)),
  ]);

  return toPaginated(rows.map(mapApiKey), totals[0]?.total ?? 0, page);
}

export async function findApiKey(workspaceId: string, apiKeyId: string, client?: PoolClient): Promise<ApiKey | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(apiKeySelection)
        .from(apiKeys)
        .leftJoin(users, eq(users.id, apiKeys.createdBy))
        .where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.id, apiKeyId)))
        .limit(1),
    client,
  );
  return rows[0] ? mapApiKey(rows[0]) : null;
}

export interface InsertApiKeyInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
}

export async function insertApiKey(input: InsertApiKeyInput, client?: PoolClient): Promise<ApiKey> {
  const inserted = await withDb(
    (db) =>
      db
        .insert(apiKeys)
        .values({
          workspaceId: input.workspaceId,
          createdBy: input.createdBy,
          name: input.name,
          keyPrefix: input.keyPrefix,
          keyHash: input.keyHash,
        })
        .returning({ id: apiKeys.id }),
    client,
  );
  const id = inserted[0]?.id;
  if (!id) throw new Error("Failed to insert API key");
  const created = await findApiKey(input.workspaceId, id, client);
  if (!created) throw new Error("API key vanished after insert");
  return created;
}

/** Revocation is permanent and idempotent: the first revocation timestamp wins. */
export async function revokeApiKeyRow(workspaceId: string, apiKeyId: string, client?: PoolClient): Promise<ApiKey | null> {
  const rows = await withDb(
    (db) =>
      db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.id, apiKeyId), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id }),
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

/** Deliberately not workspace-scoped: the workspace is the authentication result. */
export async function findApiKeyCredentialByHash(keyHash: string): Promise<ApiKeyCredentialRow | null> {
  const rows = await withDb((db) =>
    db
      .select({
        id: apiKeys.id,
        workspaceId: apiKeys.workspaceId,
        keyHash: apiKeys.keyHash,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .innerJoin(workspaces, eq(workspaces.id, apiKeys.workspaceId))
      .innerJoin(organizations, eq(organizations.id, workspaces.organizationId))
      .where(and(eq(apiKeys.keyHash, keyHash), eq(organizations.status, "active")))
      .limit(1),
  );
  const row = rows[0];
  return row ? { ...row, revokedAt: toIso(row.revokedAt) } : null;
}

export async function touchApiKeyLastUsed(apiKeyId: string): Promise<void> {
  await withDb((db) => db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, apiKeyId)));
}
