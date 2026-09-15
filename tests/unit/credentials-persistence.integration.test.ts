// @vitest-environment node
/**
 * Outbound credentials against a real PostgreSQL.
 *
 * What is tested here is what TypeScript cannot see: the SQL, the ON CONFLICT
 * upsert on the secret envelope, the case-insensitive unique index on the name,
 * the CHECK that keeps `type` and `header_name` agreeing, and the ON DELETE
 * CASCADE that is what actually guarantees deleting a credential destroys the
 * stored value.
 *
 * The property that matters most is asserted twice, at both ends: the ciphertext
 * in the table does not contain the plaintext, and nothing returned by the
 * service does either.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5432/dot" pnpm exec vitest run credentials-persistence
 *
 * Skipped when DATABASE_URL is absent, so the default suite stays hermetic.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveCredential } from "@/features/integrations/server/credential-resolver";
import {
  createCredential,
  getCredentials,
  removeCredential,
  updateCredential,
} from "@/features/integrations/server/credential-service";
import { isApiError } from "@/lib/api/api-error";

const connectionString = process.env.DATABASE_URL;
const suffix = Math.random().toString(36).slice(2, 10);

const TOKEN = "sk_live_persistence_secret";
const REPLACEMENT = "sk_live_rotated_secret";

let admin: pg.Client;
const ids = { userId: "", workspaceId: "", otherWorkspaceId: "" };

async function createWorkspace(label: string): Promise<string> {
  const org = await admin.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [
    `${label} ${suffix}`,
    `${label}-${suffix}`,
  ]);
  const organizationId = org.rows[0]!.id;
  const workspace = await admin.query<{ id: string }>(
    "INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
    [organizationId, `${label} WS`, `${label}-ws-${suffix}`],
  );
  return workspace.rows[0]!.id;
}

describe.skipIf(!connectionString)("credentials persistence", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString });
    await admin.connect();
    const user = await admin.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [`credentials-${suffix}@example.com`, "Credentials Test", "x"],
    );
    ids.userId = user.rows[0]!.id;
    ids.workspaceId = await createWorkspace("cred");
    ids.otherWorkspaceId = await createWorkspace("cred-other");
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.query("DELETE FROM organizations WHERE slug LIKE $1", [`%${suffix}`]);
    await admin.query("DELETE FROM users WHERE id = $1", [ids.userId]);
    await admin.end();
  });

  const actor = () => ({ workspaceId: ids.workspaceId, userId: ids.userId });

  it("stores the value encrypted and never returns it", async () => {
    const credential = await createCredential(actor(), {
      name: `Stripe ${suffix}`,
      type: "bearer",
      secrets: { token: TOKEN },
    });

    expect(credential.type).toBe("bearer");
    expect(credential.headerPreview).toBe("Authorization");
    expect(JSON.stringify(credential)).not.toContain(TOKEN);

    const stored = await admin.query<{ ciphertext: string }>(
      "SELECT ciphertext FROM workspace_credential_secrets WHERE credential_id = $1",
      [credential.id],
    );
    expect(stored.rows).toHaveLength(1);
    expect(Buffer.from(stored.rows[0]!.ciphertext, "base64").toString("utf8")).not.toContain("sk_live");

    // The list is the surface the browser actually sees.
    const page = await getCredentials(ids.workspaceId, { page: 1, pageSize: 20 });
    expect(JSON.stringify(page)).not.toContain(TOKEN);
  });

  it("resolves into a header the executor can send", async () => {
    const credential = await createCredential(actor(), {
      name: `Resolvable ${suffix}`,
      type: "bearer",
      secrets: { token: TOKEN },
    });

    const resolved = await resolveCredential(ids.workspaceId, credential.id);
    expect(resolved).toMatchObject({ headerName: "Authorization", headerValue: `Bearer ${TOKEN}` });
  });

  it("refuses to resolve another workspace's credential", async () => {
    const credential = await createCredential(actor(), {
      name: `Isolated ${suffix}`,
      type: "bearer",
      secrets: { token: TOKEN },
    });

    // The id is real, the workspace is not its own. The envelope is bound to
    // both, so this is "not found" rather than somebody else's token.
    expect(await resolveCredential(ids.otherWorkspaceId, credential.id)).toBeNull();
  });

  it("keeps the stored value when a field is blank and replaces it when it is not", async () => {
    const credential = await createCredential(actor(), {
      name: `Rotating ${suffix}`,
      type: "bearer",
      secrets: { token: TOKEN },
    });

    await updateCredential(actor(), credential.id, { name: `Rotating renamed ${suffix}`, secrets: { token: "" } });
    expect(await resolveCredential(ids.workspaceId, credential.id)).toMatchObject({
      name: `Rotating renamed ${suffix}`,
      headerValue: `Bearer ${TOKEN}`,
    });

    await updateCredential(actor(), credential.id, { secrets: { token: REPLACEMENT } });
    expect(await resolveCredential(ids.workspaceId, credential.id)).toMatchObject({
      headerValue: `Bearer ${REPLACEMENT}`,
    });

    // The upsert rewrote the one envelope rather than adding a second.
    const rows = await admin.query("SELECT id FROM workspace_credential_secrets WHERE credential_id = $1", [
      credential.id,
    ]);
    expect(rows.rows).toHaveLength(1);
  });

  it("stores a custom header and a basic credential in the shapes the CHECK allows", async () => {
    const custom = await createCredential(actor(), {
      name: `Custom ${suffix}`,
      type: "header",
      headerName: "X-Api-Key",
      secrets: { value: "abc123" },
    });
    expect(custom.headerPreview).toBe("X-Api-Key");
    expect(await resolveCredential(ids.workspaceId, custom.id)).toMatchObject({
      headerName: "X-Api-Key",
      headerValue: "abc123",
    });

    const basic = await createCredential(actor(), {
      name: `Basic ${suffix}`,
      type: "basic",
      secrets: { username: "alice", password: "hunter2" },
    });
    // The CHECK requires header_name to be NULL for anything but `header`.
    const row = await admin.query<{ header_name: string | null }>(
      "SELECT header_name FROM workspace_credentials WHERE id = $1",
      [basic.id],
    );
    expect(row.rows[0]!.header_name).toBeNull();
    expect(await resolveCredential(ids.workspaceId, basic.id)).toMatchObject({
      headerName: "Authorization",
      headerValue: `Basic ${Buffer.from("alice:hunter2", "utf8").toString("base64")}`,
    });
  });

  it("refuses a duplicate name, whatever its case", async () => {
    await createCredential(actor(), { name: `Unique ${suffix}`, type: "bearer", secrets: { token: TOKEN } });
    await expect(
      createCredential(actor(), { name: `unique ${suffix}`, type: "bearer", secrets: { token: TOKEN } }),
    ).rejects.toSatisfy((error: unknown) => isApiError(error) && error.code === "validation_error");
  });

  it("lets two workspaces use the same name", async () => {
    const other = { workspaceId: ids.otherWorkspaceId, userId: ids.userId };
    await createCredential(actor(), { name: `Shared name ${suffix}`, type: "bearer", secrets: { token: TOKEN } });
    // The unique index is per workspace, so this must not collide.
    await expect(
      createCredential(other, { name: `Shared name ${suffix}`, type: "bearer", secrets: { token: TOKEN } }),
    ).resolves.toMatchObject({ name: `Shared name ${suffix}` });
  });

  it("destroys the stored value when the credential is deleted", async () => {
    const credential = await createCredential(actor(), {
      name: `Doomed ${suffix}`,
      type: "bearer",
      secrets: { token: TOKEN },
    });

    await removeCredential(actor(), credential.id);

    // The cascade is the actual guarantee; asserting on the table rather than
    // on the API is the only way to see that it fired.
    const secrets = await admin.query("SELECT id FROM workspace_credential_secrets WHERE credential_id = $1", [
      credential.id,
    ]);
    expect(secrets.rows).toHaveLength(0);
    expect(await resolveCredential(ids.workspaceId, credential.id)).toBeNull();
  });

  it("will not update or delete a credential in another workspace", async () => {
    const credential = await createCredential(actor(), {
      name: `Guarded ${suffix}`,
      type: "bearer",
      secrets: { token: TOKEN },
    });
    const other = { workspaceId: ids.otherWorkspaceId, userId: ids.userId };

    await expect(updateCredential(other, credential.id, { name: "stolen", secrets: {} })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.code === "not_found",
    );
    await expect(removeCredential(other, credential.id)).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.code === "not_found",
    );
  });
});
