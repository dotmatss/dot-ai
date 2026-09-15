// @vitest-environment node
/**
 * What only a real database can settle about the platform lifecycle.
 *
 * Three claims are checked here because each one is about rows and
 * transactions rather than about a decision the service makes:
 *
 *   1. Disabling an account really ends its sessions, and re-enabling does NOT
 *      resurrect them.
 *   2. Suspending an organization really closes its key-authenticated and
 *      runtime access, and restoring it really reopens both - with no customer
 *      data deleted in between.
 *   3. A failing audit insert really rolls the state change back, rather than
 *      leaving a suspension with no record of who made it.
 *
 * Skips itself when DATABASE_URL is unset, so the default suite stays hermetic.
 * Run it with: node scripts/verify.mjs --tests platform-lifecycle
 *
 * `platform-dal` is mocked only to supply the grant lookup: the platform_admins
 * table is empty in a test database, and the point here is the SQL the service
 * runs, not the guard that already has its own suite.
 */
import { createHash, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/platform-dal", () => ({
  // The target of these tests never holds a platform grant.
  getPlatformGrant: async () => null,
}));

import { findApiKeyCredentialByHash } from "@/features/developer/server/api-key-repository";
import { changeOrganizationStatus, changeUserState } from "@/features/platform/server/platform-service";
import { assertWorkspaceActive } from "@/server/auth/lifecycle";
import { resolveSessionFromToken } from "@/server/auth/session";
import { queryOne, withTransaction } from "@/server/db/client";
import { recordPlatformAudit } from "@/server/platform/platform-audit";

const connectionString = process.env.DATABASE_URL;
const ids = { user: randomUUID(), actor: randomUUID(), org: randomUUID(), workspace: randomUUID(), key: randomUUID() };
const actor = { id: ids.actor, email: `${ids.actor}@example.test` };
const token = randomUUID();
const keyHash = createHash("sha256").update(randomUUID()).digest("hex");
let db: pg.Client;

describe.skipIf(!connectionString)("platform lifecycle persistence", () => {
  beforeAll(async () => {
    db = new pg.Client({ connectionString });
    await db.connect();
    await db.query("INSERT INTO users (id, email, name) VALUES ($1, $2, 'Operator'), ($3, $4, 'Member')", [
      ids.actor,
      actor.email,
      ids.user,
      `${ids.user}@example.test`,
    ]);
    await db.query("INSERT INTO organizations (id, name, slug) VALUES ($1, 'Lifecycle test', $2)", [ids.org, ids.org]);
    await db.query("INSERT INTO workspaces (id, organization_id, name, slug) VALUES ($1, $2, 'Workspace', $3)", [
      ids.workspace,
      ids.org,
      ids.workspace,
    ]);
    await db.query("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')", [
      ids.user,
      createHash("sha256").update(token).digest("hex"),
    ]);
    await db.query(
      `INSERT INTO api_keys (id, workspace_id, created_by, name, key_prefix, key_hash)
       VALUES ($1, $2, $3, 'test', 'test', $4)`,
      [ids.key, ids.workspace, ids.user, keyHash],
    );
  });

  afterAll(async () => {
    if (!db) return;
    await db.query("DELETE FROM organizations WHERE id = $1", [ids.org]);
    await db.query("DELETE FROM platform_audit_log WHERE target_id = ANY($1::text[])", [[ids.user, ids.org]]);
    await db.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[ids.user, ids.actor]]);
    await db.end();
  });

  it("ends sessions on disable and does not restore them on re-enable", async () => {
    expect(await resolveSessionFromToken(token)).not.toBeNull();

    await changeUserState(actor, ids.user, { disabled: true, reason: "Integration test" });

    expect(await resolveSessionFromToken(token)).toBeNull();
    const remaining = await db.query("SELECT count(*)::int AS count FROM sessions WHERE user_id = $1", [ids.user]);
    expect(remaining.rows[0].count).toBe(0);

    // Re-enabling returns the ability to sign in, not the revoked cookie.
    await changeUserState(actor, ids.user, { disabled: false });
    expect(await resolveSessionFromToken(token)).toBeNull();
  });

  it("closes key and runtime access on suspension, and reopens both without deleting data", async () => {
    expect(await findApiKeyCredentialByHash(keyHash)).not.toBeNull();

    await changeOrganizationStatus(actor, ids.org, { status: "suspended", reason: "Integration test" });

    expect(await findApiKeyCredentialByHash(keyHash)).toBeNull();
    await expect(assertWorkspaceActive(ids.workspace)).rejects.toThrow();

    // The key row was never deleted - only made unusable while suspended.
    const keyStillThere = await db.query("SELECT count(*)::int AS count FROM api_keys WHERE id = $1", [ids.key]);
    expect(keyStillThere.rows[0].count).toBe(1);

    await changeOrganizationStatus(actor, ids.org, { status: "active" });

    expect(await findApiKeyCredentialByHash(keyHash)).not.toBeNull();
    await expect(assertWorkspaceActive(ids.workspace)).resolves.toBeUndefined();
  });

  it("rolls the state change back when the audit insert fails", async () => {
    await expect(
      withTransaction(async (client) => {
        await client.query("UPDATE organizations SET status = 'disabled' WHERE id = $1", [ids.org]);
        // A non-existent actor violates the foreign key, so the record fails.
        await recordPlatformAudit(
          {
            actorId: randomUUID(),
            actorEmail: null,
            action: "organization.status.changed",
            targetType: "organization",
            targetId: ids.org,
          },
          client,
        );
      }),
    ).rejects.toThrow();

    expect(await queryOne("SELECT status::text AS status FROM organizations WHERE id = $1", [ids.org])).toEqual({
      status: "active",
    });
  });
});
