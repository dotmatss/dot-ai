// @vitest-environment node
/**
 * Exercises the integration code paths against a real PostgreSQL,
 * because the parts that can break here are the parts TypeScript cannot see:
 * the SQL itself, the jsonb round-trip, the ON CONFLICT upserts, and the
 * ON DELETE CASCADE that is what actually guarantees a disconnect destroys the
 * stored credential.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/dot_dev" pnpm exec vitest run integrations-persistence
 *
 * Skipped when DATABASE_URL is absent, so the default suite stays hermetic.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  connectIntegration,
  disconnectIntegration,
  getIntegrations,
} from "@/features/integrations/server/integration-service";
import { isApiError } from "@/lib/api/api-error";

const connectionString = process.env.DATABASE_URL;
const suffix = Math.random().toString(36).slice(2, 10);

let admin: pg.Client;
const ids = { userId: "", organizationId: "", workspaceId: "", otherWorkspaceId: "" };

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

describe.skipIf(!connectionString)("integrations persistence", () => {
  // One setup/teardown for the whole file: a per-describe afterAll would delete
  // the fixture workspace before the later blocks ran.
  beforeAll(async () => {
    admin = new pg.Client({ connectionString });
    await admin.connect();
    const user = await admin.query<{ id: string }>(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [`integrations-${suffix}@example.com`, "Integrations Test", "x"],
    );
    ids.userId = user.rows[0]!.id;
    ids.workspaceId = await createWorkspace("intg");
    ids.otherWorkspaceId = await createWorkspace("intg-other");
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.query("DELETE FROM organizations WHERE slug LIKE $1", [`%${suffix}`]);
    await admin.query("DELETE FROM users WHERE id = $1", [ids.userId]);
    await admin.end();
  });

  it("stores secrets encrypted and never returns their values", async () => {
    const actor = { workspaceId: ids.workspaceId, userId: ids.userId };
    const connected = await connectIntegration(actor, "webhook", {
      config: { url: "https://hooks.example.com/dot", events: ["conversation.resolved"] },
      secrets: { signingSecret: "whsec_super_secret_value" },
    });

    expect(connected.status).toBe("connected");
    expect(connected.configuredSecretFields).toEqual(["signingSecret"]);
    expect(JSON.stringify(connected)).not.toContain("whsec_super_secret_value");

    const stored = await admin.query<{ ciphertext: string }>(
      "SELECT s.ciphertext FROM integration_secrets s JOIN integrations i ON i.id = s.integration_id WHERE i.workspace_id = $1",
      [ids.workspaceId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(Buffer.from(stored.rows[0]!.ciphertext, "base64").toString("utf8")).not.toContain("whsec_");
  });

  it("keeps the stored secret when the field is left blank, and replaces it when it is not", async () => {
    const actor = { workspaceId: ids.workspaceId, userId: ids.userId };
    const before = await admin.query<{ ciphertext: string }>("SELECT ciphertext FROM integration_secrets WHERE workspace_id = $1", [
      ids.workspaceId,
    ]);

    const kept = await connectIntegration(actor, "webhook", {
      config: { url: "https://hooks.example.com/dot-v2", events: ["message.created"] },
      secrets: {},
    });
    expect(kept.configuredSecretFields).toEqual(["signingSecret"]);
    expect(kept.config.url).toBe("https://hooks.example.com/dot-v2");

    const replaced = await connectIntegration(actor, "webhook", {
      config: { url: "https://hooks.example.com/dot-v2", events: ["message.created"] },
      secrets: { signingSecret: "whsec_rotated" },
    });
    expect(replaced.configuredSecretFields).toEqual(["signingSecret"]);
    const after = await admin.query<{ ciphertext: string }>("SELECT ciphertext FROM integration_secrets WHERE workspace_id = $1", [
      ids.workspaceId,
    ]);
    expect(after.rows[0]!.ciphertext).not.toBe(before.rows[0]!.ciphertext);
  });

  it("rejects a configuration that would reach a private address", async () => {
    const actor = { workspaceId: ids.workspaceId, userId: ids.userId };
    await expect(
      connectIntegration(actor, "webhook", {
        config: { url: "http://169.254.169.254/latest/meta-data/", events: ["message.created"] },
        secrets: {},
      }),
    ).rejects.toSatisfy((error) => isApiError(error) && error.code === "validation_error");
  });

  it("does not leak another workspace's connections", async () => {
    expect(await getIntegrations(ids.otherWorkspaceId)).toHaveLength(0);
    expect(await getIntegrations(ids.workspaceId)).toHaveLength(1);
  });

  it("destroys the stored credential on disconnect", async () => {
    await disconnectIntegration({ workspaceId: ids.workspaceId, userId: ids.userId }, "webhook");
    expect(await getIntegrations(ids.workspaceId)).toHaveLength(0);
    const secrets = await admin.query("SELECT 1 FROM integration_secrets WHERE workspace_id = $1", [ids.workspaceId]);
    expect(secrets.rowCount).toBe(0);
  });
});
