#!/usr/bin/env node
/**
 * Minimal forward-only SQL migration runner.
 *
 *   npm run db:migrate            apply pending migrations
 *   npm run db:migrate -- --status  list applied / pending migrations
 *
 * Migrations live in src/server/db/migrations/NNNN_name.sql and are applied in
 * lexical order inside a transaction. Applied migrations are recorded in the
 * `schema_migrations` table. There is intentionally no "down" support: write a
 * new forward migration to change the schema.
 */
import { readdir, readFile } from "node:fs/promises";
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
      // Already loaded or unreadable; process.env wins.
    }
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and configure it.");
  process.exit(1);
}

const migrationsDir = path.join(root, "src", "server", "db", "migrations");
const statusOnly = process.argv.includes("--status");

const client = new pg.Client({ connectionString });

async function main() {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set((await client.query("SELECT name FROM schema_migrations ORDER BY name")).rows.map((r) => r.name));
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  if (statusOnly) {
    for (const file of files) {
      console.log(`${applied.has(file) ? "applied" : "pending"}  ${file}`);
    }
    return;
  }

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log("No pending migrations.");
    return;
  }

  for (const file of pending) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    process.stdout.write(`Applying ${file} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log("ok");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      console.log("failed");
      throw error;
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
