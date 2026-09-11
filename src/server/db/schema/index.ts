/**
 * TypeScript description of the PostgreSQL schema.
 *
 * WHAT THIS IS
 * ------------
 * A typing layer over a database that already exists. Every table here was
 * transcribed from `src/server/db/migrations/*.sql`. Adopting Drizzle changed
 * no table, no column and no row - see `docs/orm-evaluation.md`.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is NOT a security control. Row Level Security and the explicit
 * `workspace_id` filters in repository SQL are what isolate tenants. A Drizzle
 * query with a forgotten `where` is exactly as dangerous as a `SELECT` with
 * one, so `withWorkspace()` remains mandatory for tenant-scoped work.
 *
 * THINGS THIS FILE CANNOT EXPRESS
 * -------------------------------
 * Drizzle has no vocabulary for the following, so they live only in the
 * migration SQL and must be carried by hand into any generated migration:
 *
 *   - `ENABLE` / `FORCE ROW LEVEL SECURITY` and every `*_workspace_isolation`
 *     policy (see `docs/feature-conventions.md` for the required policy body)
 *   - the `set_updated_at()` trigger function and its per-table triggers
 *   - the `pgcrypto` and `citext` extensions
 *
 * Therefore: NEVER apply the output of `drizzle-kit generate` unreviewed. Read
 * it, delete any spurious `DROP`, and append the RLS block before committing.
 * `tests/unit/schema-drift.test.ts` compares this description against the live
 * database so the two cannot drift silently.
 */

export * from "@/server/db/schema/columns";
export * from "@/server/db/schema/identity";
export * from "@/server/db/schema/tenancy";
export * from "@/server/db/schema/knowledge";
export * from "@/server/db/schema/chatbots";
export * from "@/server/db/schema/workflows";
export * from "@/server/db/schema/crm";
export * from "@/server/db/schema/conversations";
export * from "@/server/db/schema/platform";
