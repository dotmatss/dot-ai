import "server-only";

import { and, count, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import type { PoolClient } from "pg";

import { credentialHeaderName } from "@/features/integrations/constants";
import type { SealedSecret } from "@/features/integrations/server/secret-box";
import type { Credential, CredentialListFilters, CredentialType } from "@/features/integrations/types";
import { withDb } from "@/server/db/client";
import { users, workspaceCredentialSecrets, workspaceCredentials } from "@/server/db/schema";
import { likePattern, normalizePage, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

/**
 * Persistence for outbound credentials.
 *
 * The ciphertext columns are reachable through exactly two functions here -
 * `findCredentialSecret` and `upsertCredentialSecret` - and no selection used
 * by a list or detail read touches that table. That is the property the
 * two-table split exists to give: "what can read a secret" is answerable by
 * reading this file.
 */

const credentialSelection = {
  id: workspaceCredentials.id,
  name: workspaceCredentials.name,
  type: workspaceCredentials.type,
  headerName: workspaceCredentials.headerName,
  lastUsedAt: workspaceCredentials.lastUsedAt,
  createdAt: workspaceCredentials.createdAt,
  updatedAt: workspaceCredentials.updatedAt,
  createdByName: users.name,
};

interface CredentialRow {
  id: string;
  name: string;
  type: CredentialType;
  headerName: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdByName: string | null;
}

function mapCredential(row: CredentialRow): Credential {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    headerPreview: credentialHeaderName(row.type, row.headerName),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
    createdByName: row.createdByName,
    lastUsedAt: toIso(row.lastUsedAt),
  };
}

export async function listCredentials(
  workspaceId: string,
  filters: CredentialListFilters,
): Promise<Paginated<Credential>> {
  const page = normalizePage(filters);

  const conditions: Array<SQL | undefined> = [eq(workspaceCredentials.workspaceId, workspaceId)];
  if (filters.type) conditions.push(eq(workspaceCredentials.type, filters.type));
  if (filters.search) conditions.push(ilike(workspaceCredentials.name, likePattern(filters.search)));
  // Built once and reused by both queries below, so the page and its total
  // cannot describe different sets.
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db
        .select(credentialSelection)
        .from(workspaceCredentials)
        .leftJoin(users, eq(users.id, workspaceCredentials.createdBy))
        .where(where)
        .orderBy(desc(workspaceCredentials.createdAt))
        .limit(page.pageSize)
        .offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(workspaceCredentials).where(where)),
  ]);

  return toPaginated(rows.map(mapCredential), totals[0]?.total ?? 0, page);
}

export async function findCredential(
  workspaceId: string,
  credentialId: string,
  client?: PoolClient,
): Promise<Credential | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(credentialSelection)
        .from(workspaceCredentials)
        .leftJoin(users, eq(users.id, workspaceCredentials.createdBy))
        .where(and(eq(workspaceCredentials.workspaceId, workspaceId), eq(workspaceCredentials.id, credentialId)))
        .limit(1),
    client,
  );
  return rows[0] ? mapCredential(rows[0]) : null;
}

/** Raw row including `headerName`, which `Credential` folds into `headerPreview`. */
export interface CredentialRecord {
  id: string;
  name: string;
  type: CredentialType;
  headerName: string | null;
}

export async function findCredentialRecord(
  workspaceId: string,
  credentialId: string,
  client?: PoolClient,
): Promise<CredentialRecord | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          id: workspaceCredentials.id,
          name: workspaceCredentials.name,
          type: workspaceCredentials.type,
          headerName: workspaceCredentials.headerName,
        })
        .from(workspaceCredentials)
        .where(and(eq(workspaceCredentials.workspaceId, workspaceId), eq(workspaceCredentials.id, credentialId)))
        .limit(1),
    client,
  );
  return rows[0] ?? null;
}

export interface InsertCredentialInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  type: CredentialType;
  headerName: string | null;
}

export async function insertCredential(input: InsertCredentialInput, client?: PoolClient): Promise<string> {
  const rows = await withDb(
    (db) =>
      db
        .insert(workspaceCredentials)
        .values({
          workspaceId: input.workspaceId,
          createdBy: input.createdBy,
          name: input.name,
          type: input.type,
          headerName: input.headerName,
        })
        .returning({ id: workspaceCredentials.id }),
    client,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Failed to insert credential");
  return id;
}

export async function updateCredentialRow(
  workspaceId: string,
  credentialId: string,
  values: { name?: string; headerName?: string | null },
  client?: PoolClient,
): Promise<boolean> {
  const patch: { name?: string; headerName?: string | null; updatedAt: Date } = { updatedAt: new Date() };
  if (values.name !== undefined) patch.name = values.name;
  if (values.headerName !== undefined) patch.headerName = values.headerName;

  const rows = await withDb(
    (db) =>
      db
        .update(workspaceCredentials)
        .set(patch)
        .where(and(eq(workspaceCredentials.workspaceId, workspaceId), eq(workspaceCredentials.id, credentialId)))
        .returning({ id: workspaceCredentials.id }),
    client,
  );
  return rows.length > 0;
}

export async function deleteCredential(
  workspaceId: string,
  credentialId: string,
  client?: PoolClient,
): Promise<boolean> {
  const rows = await withDb(
    (db) =>
      db
        .delete(workspaceCredentials)
        .where(and(eq(workspaceCredentials.workspaceId, workspaceId), eq(workspaceCredentials.id, credentialId)))
        .returning({ id: workspaceCredentials.id }),
    client,
  );
  // The secret row is removed by ON DELETE CASCADE, so deleting a credential
  // always destroys its stored material.
  return rows.length > 0;
}

/** True when another credential in this workspace already holds the name. */
export async function credentialNameTaken(
  workspaceId: string,
  name: string,
  excludeId: string | null,
  client?: PoolClient,
): Promise<boolean> {
  const rows = await withDb(
    (db) =>
      db
        .select({ id: workspaceCredentials.id })
        .from(workspaceCredentials)
        .where(
          and(
            eq(workspaceCredentials.workspaceId, workspaceId),
            sql`lower(${workspaceCredentials.name}) = lower(${name})`,
            excludeId ? sql`${workspaceCredentials.id} <> ${excludeId}` : undefined,
          ),
        )
        .limit(1),
    client,
  );
  return rows.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Ciphertext. Everything below reads or writes secret material.               */
/* -------------------------------------------------------------------------- */

export async function findCredentialSecret(
  workspaceId: string,
  credentialId: string,
  client?: PoolClient,
): Promise<SealedSecret | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          ciphertext: workspaceCredentialSecrets.ciphertext,
          iv: workspaceCredentialSecrets.iv,
          tag: workspaceCredentialSecrets.tag,
        })
        .from(workspaceCredentialSecrets)
        .where(
          and(
            eq(workspaceCredentialSecrets.workspaceId, workspaceId),
            eq(workspaceCredentialSecrets.credentialId, credentialId),
          ),
        )
        .limit(1),
    client,
  );
  return rows[0] ?? null;
}

export async function upsertCredentialSecret(
  workspaceId: string,
  credentialId: string,
  sealed: SealedSecret,
  client?: PoolClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .insert(workspaceCredentialSecrets)
        .values({ workspaceId, credentialId, ...sealed })
        .onConflictDoUpdate({
          target: workspaceCredentialSecrets.credentialId,
          set: { ...sealed, updatedAt: new Date() },
        }),
    client,
  );
}

/**
 * Records that a credential was used.
 *
 * Best-effort and deliberately outside any run transaction: it is operational
 * metadata, and failing to write it must not fail the request that used the
 * credential.
 */
export async function touchCredentialLastUsed(workspaceId: string, credentialId: string): Promise<void> {
  await withDb((db) =>
    db
      .update(workspaceCredentials)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(workspaceCredentials.workspaceId, workspaceId), eq(workspaceCredentials.id, credentialId))),
  );
}
