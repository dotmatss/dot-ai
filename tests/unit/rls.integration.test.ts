// @vitest-environment node
/**
 * Proves the second layer of tenant isolation actually holds.
 *
 * Repository SQL always filters on workspace_id; Row Level Security is the
 * defence behind that, for the day a query forgets. This test connects as a
 * NON-SUPERUSER role on purpose: PostgreSQL superusers bypass RLS entirely, so
 * a suite run as `postgres` would pass while production was wide open. That is
 * exactly the deployment caveat recorded in docs/adr/0002-tenant-isolation.md.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/dot_dev" pnpm exec vitest run rls
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.DATABASE_URL;
const hasDatabase = Boolean(connectionString);
const suffix = Math.random().toString(36).slice(2, 10);
const APP_ROLE = `dot_rls_test_${suffix}`;
const APP_PASSWORD = "rls-test-password";

let admin: pg.Client;
let app: pg.Client;
const ids = { orgA: "", orgB: "", workspaceA: "", workspaceB: "", userId: "" };

async function createTenant(name: string): Promise<{ organizationId: string; workspaceId: string }> {
  const org = await admin.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [
    name,
    `${name.toLowerCase()}-${suffix}`,
  ]);
  const organizationId = org.rows[0]!.id;
  const workspace = await admin.query<{ id: string }>(
    "INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
    [organizationId, `${name} WS`, `${name.toLowerCase()}-ws-${suffix}`],
  );
  const workspaceId = workspace.rows[0]!.id;
  await admin.query(
    `INSERT INTO chatbots (workspace_id, created_by, name, slug, embed_key)
     VALUES ($1, $2, $3, $4, $5)`,
    [workspaceId, ids.userId, `${name} bot`, `${name.toLowerCase()}-bot-${suffix}`, `cb_rls_${name}_${suffix}`],
  );
  return { organizationId, workspaceId };
}

/** Runs a statement with the workspace scope the application would set. */
async function asWorkspace<T extends pg.QueryResultRow>(
  workspaceId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await app.query("BEGIN");
  try {
    if (workspaceId) await app.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
    const result = await app.query<T>(sql, params);
    return result.rows;
  } finally {
    await app.query("COMMIT");
  }
}

describe.skipIf(!hasDatabase)("row level security", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString });
    await admin.connect();

    const user = await admin.query<{ id: string }>(
      "INSERT INTO users (email, name) VALUES ($1, 'RLS Test') RETURNING id",
      [`rls-${suffix}@example.test`],
    );
    ids.userId = user.rows[0]!.id;

    const a = await createTenant("Alpha");
    const b = await createTenant("Beta");
    ids.orgA = a.organizationId;
    ids.workspaceA = a.workspaceId;
    ids.orgB = b.organizationId;
    ids.workspaceB = b.workspaceId;

    await admin.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}'`);
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
    await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);

    const url = new URL(connectionString!);
    app = new pg.Client({
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.slice(1),
      user: APP_ROLE,
      password: APP_PASSWORD,
    });
    await app.connect();
  }, 60_000);

  afterAll(async () => {
    if (!hasDatabase) return;
    await app?.end().catch(() => undefined);
    if (admin) {
      await admin.query(`DROP OWNED BY ${APP_ROLE}`).catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS ${APP_ROLE}`).catch(() => undefined);
      await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [[ids.orgA, ids.orgB]]).catch(() => undefined);
      await admin.query("DELETE FROM users WHERE id = $1", [ids.userId]).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  it("confirms the test really is running without superuser privileges", async () => {
    const rows = await asWorkspace<{ superuser: boolean; bypassrls: boolean }>(
      null,
      "SELECT rolsuper AS superuser, rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = current_user",
    );
    expect(rows[0]?.superuser).toBe(false);
    expect(rows[0]?.bypassrls).toBe(false);
  });

  it("hides other tenants' rows from a query that forgot to filter", async () => {
    // Deliberately no workspace_id predicate: the policy is the only guard.
    const rows = await asWorkspace<{ workspace_id: string }>(ids.workspaceA, "SELECT workspace_id FROM chatbots");

    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.workspace_id))).toEqual(new Set([ids.workspaceA]));
  });

  it("blocks a direct read of another tenant's row by id", async () => {
    const rows = await asWorkspace<{ id: string }>(ids.workspaceA, "SELECT id FROM chatbots WHERE workspace_id = $1", [
      ids.workspaceB,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("refuses to write a row into another tenant's workspace", async () => {
    await expect(
      asWorkspace<{ id: string }>(ids.workspaceA, "UPDATE chatbots SET name = 'hijacked' WHERE workspace_id = $1 RETURNING id", [
        ids.workspaceB,
      ]),
    ).resolves.toHaveLength(0);

    await expect(
      asWorkspace<{ id: string }>(
        ids.workspaceA,
        `INSERT INTO chatbots (workspace_id, name, slug, embed_key) VALUES ($1, 'smuggled', $2, $3)`,
        [ids.workspaceB, `smuggled-${suffix}`, `cb_smuggled_${suffix}`],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("holds the convention for every tenant table, including ones added later", async () => {
    // Guards the rule that new feature migrations must follow, so a table added
    // months from now cannot quietly ship without isolation.
    const tables = await admin.query<{
      table: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
      unsafe_policies: number;
    }>(
      `SELECT c.relname AS table,
              c.relrowsecurity AS enabled,
              c.relforcerowsecurity AS forced,
              count(p.polname)::int AS policies,
              count(p.polname) FILTER (
                WHERE upper(pg_get_expr(p.polqual, p.polrelid)) NOT LIKE '%NULLIF%'
              )::int AS unsafe_policies
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'workspace_id' AND NOT a.attisdropped
       LEFT JOIN pg_policy p ON p.polrelid = c.oid
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
       ORDER BY c.relname`,
    );

    expect(tables.rows.length).toBeGreaterThan(10);
    const failures = tables.rows.filter(
      (row) => !row.enabled || !row.forced || row.policies === 0 || row.unsafe_policies > 0,
    );
    expect(
      failures.map((row) => `${row.table}: enabled=${row.enabled} forced=${row.forced} policies=${row.policies} unsafe=${row.unsafe_policies}`),
    ).toEqual([]);
  });

  it("still allows unscoped maintenance work, so migrations and jobs keep working", async () => {
    const rows = await asWorkspace<{ workspace_id: string }>(null, "SELECT workspace_id FROM chatbots");
    const workspaces = new Set(rows.map((row) => row.workspace_id));
    expect(workspaces.has(ids.workspaceA)).toBe(true);
    expect(workspaces.has(ids.workspaceB)).toBe(true);
  });
});
