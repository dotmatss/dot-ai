#!/usr/bin/env node
/**
 * Development seed: creates a demo user, organization and workspace with one
 * chatbot so the dashboard is not empty. Safe to re-run (idempotent by email).
 *
 *   npm run db:seed
 *   SEED_EMAIL=you@example.com SEED_PASSWORD=... npm run db:seed
 *
 * Never run against production data.
 */
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // ignore
    }
  }
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed in production.");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const email = (process.env.SEED_EMAIL ?? "demo@example.com").toLowerCase();
const password = process.env.SEED_PASSWORD ?? randomBytes(9).toString("base64url");

// Must match src/server/auth/password.ts
function hashPassword(plain) {
  const salt = randomBytes(16);
  const params = { N: 16384, r: 8, p: 1 };
  return new Promise((resolve, reject) => {
    scryptCallback(plain.normalize("NFKC"), salt, 64, params, (error, derived) => {
      if (error) return reject(error);
      resolve(["scrypt", params.N, params.r, params.p, salt.toString("base64"), derived.toString("base64")].join("$"));
    });
  });
}

const client = new pg.Client({ connectionString });

async function main() {
  await client.connect();
  await client.query("BEGIN");

  const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
  let userId = existing.rows[0]?.id;
  if (!userId) {
    const hash = await hashPassword(password);
    const user = await client.query(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [email, "Demo User", hash],
    );
    userId = user.rows[0].id;
    console.log(`Created user ${email} with password: ${password}`);
  } else {
    console.log(`User ${email} already exists; password unchanged.`);
  }

  let org = await client.query(
    "SELECT o.id FROM organizations o JOIN organization_members m ON m.organization_id = o.id WHERE m.user_id = $1 LIMIT 1",
    [userId],
  );
  let organizationId = org.rows[0]?.id;
  if (!organizationId) {
    org = await client.query("INSERT INTO organizations (name, slug) VALUES ('Demo Co', 'demo-co') RETURNING id");
    organizationId = org.rows[0].id;
    await client.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [organizationId, userId]);
  }

  let ws = await client.query("SELECT id, slug FROM workspaces WHERE organization_id = $1 LIMIT 1", [organizationId]);
  let workspace = ws.rows[0];
  if (!workspace) {
    ws = await client.query("INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, 'Demo Workspace', 'demo') RETURNING id, slug", [organizationId]);
    workspace = ws.rows[0];
  }

  const bots = await client.query("SELECT id FROM chatbots WHERE workspace_id = $1", [workspace.id]);
  if (bots.rows.length === 0) {
    await client.query(
      `INSERT INTO chatbots (workspace_id, created_by, name, slug, description, instructions, embed_key, allowed_domains)
       VALUES ($1, $2, 'Support Assistant', 'support-assistant', 'Answers product and billing questions.',
               'You are a friendly support assistant. Keep answers short and cite sources when available.',
               $3, ARRAY['localhost:3000'])`,
      [workspace.id, userId, `cb_${randomBytes(12).toString("base64url")}`],
    );
    await client.query(
      `INSERT INTO activity_log (workspace_id, actor_id, entity_type, entity_id, action, summary)
       SELECT $1, $2, 'chatbot', id, 'created', 'Created chatbot “Support Assistant”' FROM chatbots WHERE workspace_id = $1`,
      [workspace.id, userId],
    );
  }

  await client.query("COMMIT");
  console.log(`Seed complete. Sign in at /sign-in and open /w/${workspace.slug}/dashboard`);
}

main()
  .catch(async (error) => {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
