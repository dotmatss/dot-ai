// @vitest-environment node
/**
 * API key minting, authentication and revocation against a real PostgreSQL.
 *
 * Split out of `integrations-persistence` when API keys moved to
 * `src/features/developer/`: what this covers is the INBOUND direction, and
 * keeping it beside the outbound integration tests was part of the confusion
 * the split exists to remove.
 *
 * The path worth exercising end to end is the one TypeScript cannot check: a
 * key is minted, only its hash reaches the table, the hash resolves back to the
 * right workspace on a real request, and revocation actually stops it.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5432/dot" pnpm exec vitest run developer-persistence
 *
 * Skipped when DATABASE_URL is absent, so the default suite stays hermetic.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authenticateApiKey } from "@/features/developer/server/api-key-auth";
import { createApiKey, getApiKeys, revokeApiKey } from "@/features/developer/server/api-key-service";

const connectionString = process.env.DATABASE_URL;
const suffix = Math.random().toString(36).slice(2, 10);

let admin: pg.Client;
const ids = { userId: "", workspaceId: "" };

describe.skipIf(!connectionString)("developer persistence", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString });
    await admin.connect();
    const user = await admin.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [`developer-${suffix}@example.com`, "Developer Test", "x"],
    );
    ids.userId = user.rows[0]!.id;
    const org = await admin.query<{ id: string }>("INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id", [
      `dev ${suffix}`,
      `dev-${suffix}`,
    ]);
    const workspace = await admin.query<{ id: string }>(
      "INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
      [org.rows[0]!.id, "Dev WS", `dev-ws-${suffix}`],
    );
    ids.workspaceId = workspace.rows[0]!.id;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.query("DELETE FROM organizations WHERE slug LIKE $1", [`%${suffix}`]);
    await admin.query("DELETE FROM users WHERE id = $1", [ids.userId]);
    await admin.end();
  });

  it("mints a key that authenticates, resolves its workspace, and stops at revocation", async () => {
    const actor = { workspaceId: ids.workspaceId, userId: ids.userId };
    const { apiKey, secret } = await createApiKey(actor, { name: "Smoke test key" });

    expect(secret.startsWith("dot_live_")).toBe(true);
    const stored = await admin.query<{ key_hash: string }>("SELECT key_hash FROM api_keys WHERE id = $1", [apiKey.id]);
    expect(stored.rows[0]!.key_hash).not.toContain(secret);

    const request = new Request("https://app.example.com/api/v1/public/chat", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(await authenticateApiKey(request)).toEqual({ workspaceId: ids.workspaceId, apiKeyId: apiKey.id });

    // An unknown key resolves to nothing rather than to some workspace.
    const unknown = new Request("https://app.example.com/api/v1/public/chat", {
      method: "POST",
      headers: { authorization: `Bearer dot_live_${"a".repeat(32)}` },
    });
    expect(await authenticateApiKey(unknown)).toBeNull();

    await revokeApiKey(actor, apiKey.id);
    expect(await authenticateApiKey(request)).toBeNull();

    const revokedList = await getApiKeys(ids.workspaceId, { status: "revoked" });
    expect(revokedList.items.map((item) => item.id)).toContain(apiKey.id);
    expect(revokedList.items[0]?.revokedAt).toBeTypeOf("string");

    const activeList = await getApiKeys(ids.workspaceId, { status: "active" });
    expect(activeList.items.map((item) => item.id)).not.toContain(apiKey.id);
  });
});
