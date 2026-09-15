import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration.
 *
 * IMPORTANT: `out` is a STAGING directory, not the migrations directory.
 *
 * `pnpm db:migrate` applies every `.sql` file in
 * `src/server/db/migrations/` in lexical order. If drizzle-kit wrote there
 * directly, its generated baseline would be applied on the next deploy and
 * would try to recreate tables that already exist. So generated SQL lands in
 * `drizzle/` for review, and the reviewed statements are copied by hand into a
 * new `src/server/db/migrations/NNNN_<feature>.sql` together with the Row
 * Level Security block from `docs/feature-conventions.md`, which drizzle-kit
 * cannot express and will never emit.
 *
 * See `docs/orm-evaluation.md` for the full workflow.
 */

const root = process.cwd();
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Already loaded, or unreadable. Whatever is in process.env wins.
    }
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and configure it.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
