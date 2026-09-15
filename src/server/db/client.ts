import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { getServerEnv } from "@/config/env";
import { ApiError } from "@/lib/api/api-error";
import { DatabaseUnavailableError } from "@/server/db/errors";
import * as schema from "@/server/db/schema";

/**
 * PostgreSQL access boundary.
 *
 * - One pool per process (cached on globalThis so dev HMR does not leak pools).
 * - Every tenant-scoped query goes through `withWorkspace`, which runs inside a
 *   transaction with `app.workspace_id` set so Row Level Security policies in
 *   the database enforce tenant isolation as a second layer behind the
 *   explicit `workspace_id` filters in repository SQL.
 */

declare global {
  var __dotPgPool: Pool | undefined;
  var __dotDrizzle: Database | undefined;
}

// Re-exported so existing importers keep working; defined in a leaf module so
// the error mapper does not have to import the pool. See db/errors.ts.
export { DatabaseUnavailableError };

function createPool(): Pool {
  const env = getServerEnv();
  if (!env.DATABASE_URL) {
    throw new DatabaseUnavailableError("DATABASE_URL is not configured. Copy .env.example to .env.local and set it.");
  }
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", (error) => {
    console.error("[db] idle client error", error);
  });
  return pool;
}

export function getPool(): Pool {
  if (!globalThis.__dotPgPool) {
    globalThis.__dotPgPool = createPool();
  }
  return globalThis.__dotPgPool;
}

export type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

/**
 * Typed query builder over the same pool.
 *
 * Drizzle is a typing and row-mapping layer, nothing more. It rides the `pg`
 * pool this module already owns, so connection limits, error translation and -
 * critically - the transaction that carries `app.workspace_id` are unchanged.
 * See `src/server/db/schema/index.ts` and `docs/orm-evaluation.md`.
 */
export type Database = NodePgDatabase<typeof schema>;
/** A pool or a checked-out client that Drizzle can bind to. */
export type DatabaseClient = Pool | PoolClient;

export function getDb(): Database {
  if (!globalThis.__dotDrizzle) {
    globalThis.__dotDrizzle = drizzle(getPool(), { schema });
  }
  return globalThis.__dotDrizzle;
}

/**
 * Binds Drizzle to one transaction's connection.
 *
 * This is what keeps Row Level Security working: `withWorkspace()` sets
 * `app.workspace_id` on a specific connection, and only statements sent on
 * that same connection see it. Reaching for `getDb()` inside a workspace
 * transaction would silently escape both the transaction and the setting.
 */
export function dbFor(client: DatabaseClient): Database {
  return drizzle(client, { schema });
}

/**
 * Runs a Drizzle query with the same error contract as `query()`: unique
 * violations become 409s, missing references 400s, and connection failures
 * `DatabaseUnavailableError`. Pass the transaction client when inside one.
 */
export async function withDb<T>(fn: (db: Database) => Promise<T>, client?: DatabaseClient): Promise<T> {
  try {
    return await fn(client ? dbFor(client) : getDb());
  } catch (error) {
    throw translateDbError(error);
  }
}

function isConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "28P01" || // invalid_password
    code === "3D000" || // invalid_catalog_name (database does not exist)
    code === "57P03" // cannot_connect_now
  );
}

/** Translates low-level driver failures into boundary errors. */
export function translateDbError(error: unknown): Error {
  if (error instanceof DatabaseUnavailableError || error instanceof ApiError) return error;
  if (isConnectionError(error)) {
    return new DatabaseUnavailableError("Could not connect to PostgreSQL. Check DATABASE_URL and that the server is running.", {
      cause: error,
    });
  }
  const code = sqlStateOf(error);
  if (code === "23505") return ApiError.conflict("A record with the same unique value already exists");
  if (code === "23503") return ApiError.badRequest("Referenced record does not exist");
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Finds the PostgreSQL SQLSTATE on an error, wrapped or not.
 *
 * `query()` gets the driver's error directly, but Drizzle wraps it in a
 * `DrizzleQueryError` that carries the statement and its parameters and leaves
 * `code` undefined - so reading `error.code` translated a raw `pg` failure and
 * silently missed the identical failure raised through `withDb()`. That made
 * the documented contract ("unique violations become 409s") true of one path
 * and false of the other, which is worse than either, because a repository
 * migrated to Drizzle stopped returning 409s without anything failing.
 *
 * The chain is walked with a depth bound rather than to exhaustion: a cyclic
 * `cause` is not a thing this should hang on.
 */
function sqlStateOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = [], client?: Queryable): Promise<T[]> {
  try {
    const result = await (client ?? getPool()).query<T>(text, params);
    return result.rows;
  } catch (error) {
    throw translateDbError(error);
  }
}

export async function queryOne<T extends QueryResultRow>(text: string, params: unknown[] = [], client?: Queryable): Promise<T | null> {
  const rows = await query<T>(text, params, client);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await getPool().connect();
  } catch (error) {
    throw translateDbError(error);
  }
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw translateDbError(error);
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` in a transaction scoped to one workspace. The workspace id is
 * exposed to PostgreSQL as `app.workspace_id` for RLS policies.
 */
export async function withWorkspace<T>(workspaceId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(async (client) => {
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
    return fn(client);
  });
}

/** Lightweight connectivity probe for health checks and setup diagnostics. */
export async function pingDatabase(): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  try {
    const row = await queryOne<{ version: string }>("SELECT version() AS version");
    return { ok: true, version: row?.version ?? "unknown" };
  } catch (error) {
    const translated = translateDbError(error);
    return { ok: false, error: translated.message };
  }
}
