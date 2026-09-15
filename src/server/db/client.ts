import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client, Pool, type PoolClient, type QueryResultRow } from "pg";

import { getServerEnv } from "@/config/env";
import { ApiError } from "@/lib/api/api-error";
import { DatabaseUnavailableError } from "@/server/db/errors";
import * as schema from "@/server/db/schema";

/**
 * PostgreSQL access boundary.
 *
 * - Every tenant-scoped query goes through `withWorkspace`, which runs inside a
 *   transaction with `app.workspace_id` set so Row Level Security policies in
 *   the database enforce tenant isolation as a second layer behind the
 *   explicit `workspace_id` filters in repository SQL.
 *
 * ## Two runtimes, one contract
 *
 * This module runs both on Node (`next dev`, `next build`, tests) and on
 * Cloudflare Workers (`vinext build`, see `docs/deployment.md`). Connections
 * are acquired differently in each, and `withConnection` is the only place
 * that knows the difference:
 *
 * - **Node** keeps one long-lived `pg.Pool` per process, cached on
 *   `globalThis` so dev HMR does not leak pools.
 * - **Workers** creates one `pg.Client` per acquisition against the Hyperdrive
 *   binding. A pool cannot be cached across requests there: a socket opened
 *   during one request cannot be used by the next, and reusing one raises
 *   "Cannot perform I/O on behalf of a different request". Hyperdrive owns the
 *   real pool on Cloudflare's side, so per-request clients are cheap and are
 *   what Cloudflare recommends for `node-postgres`.
 *
 * Everything above `withConnection` - `query`, `withDb`, `withTransaction`,
 * `withWorkspace` - behaves identically on both.
 */

declare global {
  var __dotPgPool: Pool | undefined;
}

// Re-exported so existing importers keep working; defined in a leaf module so
// the error mapper does not have to import the pool. See db/errors.ts.
export { DatabaseUnavailableError };

/**
 * The Hyperdrive connection string, or `null` on Node.
 *
 * `cloudflare:workers` is a workerd built-in that does not exist on Node, so it
 * is imported through a variable specifier: a bare `import("cloudflare:workers")`
 * would be statically resolved by the Node/Next build and fail there. On
 * workerd the module is provided by the runtime, so nothing needs bundling.
 *
 * Reading `.connectionString` is a property access, not I/O, so it is safe
 * outside a request context. Resolved once per isolate.
 */
let hyperdriveConnectionString: string | null | undefined;

async function getHyperdriveConnectionString(): Promise<string | null> {
  if (hyperdriveConnectionString !== undefined) return hyperdriveConnectionString;
  try {
    const specifier = "cloudflare:workers";
    const workers = (await import(/* @vite-ignore */ specifier)) as {
      env?: { HYPERDRIVE?: { connectionString?: string } };
    };
    hyperdriveConnectionString = workers.env?.HYPERDRIVE?.connectionString ?? null;
  } catch {
    // Not running on workerd. Fall back to DATABASE_URL.
    hyperdriveConnectionString = null;
  }
  return hyperdriveConnectionString;
}

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

function getPool(): Pool {
  if (!globalThis.__dotPgPool) {
    globalThis.__dotPgPool = createPool();
  }
  return globalThis.__dotPgPool;
}

/**
 * Closes the Node pool, if one was opened.
 *
 * Test teardown only: an open pool keeps the process alive, so integration
 * suites call this in `afterAll`. A no-op on Workers, where there is no pool
 * to close - connections there are ended as each `withConnection` returns.
 */
export async function closePool(): Promise<void> {
  const pool = globalThis.__dotPgPool;
  if (!pool) return;
  globalThis.__dotPgPool = undefined;
  await pool.end();
}

export type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

/**
 * Runs `fn` with one connection checked out, and returns it afterwards however
 * this runtime requires. See the runtime note at the top of this file.
 *
 * The client handed to `fn` is typed as `PoolClient` on both runtimes. On
 * Workers the underlying value is a `pg.Client` given a no-op `release()`:
 * callers only ever pass the client onward to `query()` or `withDb()` as an
 * opaque token and never call a method on it themselves, so the shape they
 * actually depend on is `query()`. The cast keeps that single difference here
 * instead of spreading a union type through every repository signature.
 */
export async function withConnection<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const connectionString = await getHyperdriveConnectionString();

  if (connectionString !== null) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
    } catch (error) {
      throw translateDbError(error);
    }
    const asPoolClient = Object.assign(client, { release: () => {} }) as unknown as PoolClient;
    try {
      return await fn(asPoolClient);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  let client: PoolClient;
  try {
    client = await getPool().connect();
  } catch (error) {
    throw translateDbError(error);
  }
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Typed query builder over the same connection.
 *
 * Drizzle is a typing and row-mapping layer, nothing more. It rides the
 * connection this module hands out, so connection limits, error translation
 * and - critically - the transaction that carries `app.workspace_id` are
 * unchanged. See `src/server/db/schema/index.ts` and `docs/orm-evaluation.md`.
 */
export type Database = NodePgDatabase<typeof schema>;
/** A pool or a checked-out client that Drizzle can bind to. */
export type DatabaseClient = Pool | PoolClient;

/**
 * Binds Drizzle to one transaction's connection.
 *
 * This is what keeps Row Level Security working: `withWorkspace()` sets
 * `app.workspace_id` on a specific connection, and only statements sent on
 * that same connection see it. Reaching for a fresh connection inside a
 * workspace transaction would silently escape both the transaction and the
 * setting.
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
  if (client) {
    try {
      return await fn(dbFor(client));
    } catch (error) {
      throw translateDbError(error);
    }
  }
  return withConnection(async (connection) => {
    try {
      return await fn(dbFor(connection));
    } catch (error) {
      throw translateDbError(error);
    }
  });
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
  if (client) {
    try {
      const result = await client.query<T>(text, params);
      return result.rows;
    } catch (error) {
      throw translateDbError(error);
    }
  }
  return withConnection(async (connection) => {
    try {
      const result = await connection.query<T>(text, params);
      return result.rows;
    } catch (error) {
      throw translateDbError(error);
    }
  });
}

export async function queryOne<T extends QueryResultRow>(text: string, params: unknown[] = [], client?: Queryable): Promise<T | null> {
  const rows = await query<T>(text, params, client);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withConnection(async (client) => {
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw translateDbError(error);
    }
  });
}

/**
 * Runs `fn` in a transaction scoped to one workspace. The workspace id is
 * exposed to PostgreSQL as `app.workspace_id` for RLS policies.
 *
 * The `set_config` is transaction-local (third argument `true`), which is what
 * makes this correct under Hyperdrive's transaction-mode pooling on Workers:
 * the setting is discarded at COMMIT, so a connection returned to Hyperdrive's
 * pool can never carry one workspace's id into another workspace's queries.
 */
export async function withWorkspace<T>(workspaceId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(async (client) => {
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
    return fn(client);
  });
}

/** Lightweight connectivity probe for health checks and setup diagnostics. */
/**
 * Liveness AND readiness, which are not the same question.
 *
 * `SELECT version()` alone answers "can this runtime reach a PostgreSQL",
 * which a completely empty database answers with a cheerful yes. That is not a
 * hypothetical: a deployment once pointed at a Supabase project whose
 * migrations had never been run, `/api/health` reported `database: ok`, the CI
 * smoke test passed on it, and the first person to load the sign-in page got
 * "Something went wrong" from a failed `SELECT ... FROM users`. Connectivity
 * was never the thing worth checking.
 *
 * So the probe asks a second question: is the schema actually there.
 * `to_regclass` resolves a table name to an OID, or NULL if it does not exist -
 * no rows are read, no permissions on the contents are needed, and it cannot
 * fail merely because the table is empty. `users` is the right table to name:
 * every authenticated request begins with it, so a deployment where this is
 * NULL is a deployment where nobody can sign in.
 *
 * Both answers are returned separately because they call for different actions:
 * "cannot reach the database" is a connection string, a firewall or an outage,
 * while "reached it and the schema is missing" is one command - `db:migrate`
 * against the right DATABASE_URL.
 */
export async function pingDatabase(): Promise<
  { ok: true; version: string; schema: boolean } | { ok: false; error: string; schema: false }
> {
  try {
    const row = await queryOne<{ version: string; users_table: string | null }>(
      "SELECT version() AS version, to_regclass('public.users')::text AS users_table",
    );
    return { ok: true, version: row?.version ?? "unknown", schema: Boolean(row?.users_table) };
  } catch (error) {
    const translated = translateDbError(error);
    return { ok: false, error: translated.message, schema: false };
  }
}
