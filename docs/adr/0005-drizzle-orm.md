# ADR 0005 — Drizzle ORM behind the existing data-access boundary

**Status:** Accepted · **Date:** 2026-09-11

## Context

Ten repository modules held roughly 158 hand-written `query`/`queryOne` call sites, each pairing a SQL string with a hand-maintained row interface. Nothing verified that the two matched. A renamed column, a changed nullability or a mistyped `count(*)` was a runtime failure, not a compile error, and the row interfaces had already started to drift from the migrations.

The constraint that decides this is not query ergonomics. Tenant isolation depends on Row Level Security driven by `set_config('app.workspace_id', $1, true)`, which is **transaction-local** and therefore **connection-local**. Migrations also carry things no ORM schema language can express: `FORCE ROW LEVEL SECURITY`, cast-safe policy predicates, `citext` and `pgcrypto`, an `updated_at` trigger, partial unique indexes, and a GIN index over `to_tsvector('english', content)`.

The full comparison is in [`docs/orm-evaluation.md`](../orm-evaluation.md).

## Decision

- **Adopt `drizzle-orm`**, keeping `pg` as the driver through `drizzle-orm/node-postgres`. Prisma was rejected for this codebase: it cannot express the policies and triggers, it requires a codegen step before typecheck, and transaction-scoped `set_config` is the pattern it is least comfortable with.
- **SQL remains the source of truth for the schema.** `src/server/db/schema/` describes tables that already exist. Adopting Drizzle changed no table, column, index, policy or row.
- **The boundary does not move.** `query`, `queryOne`, `withTransaction` and `withWorkspace` keep their exact signatures. `src/server/db/client.ts` gains `getDb()`, `dbFor(client)` and `withDb(fn, client?)`.
- **Inside a workspace transaction, Drizzle binds to that transaction's connection** via `dbFor(client)`. `getDb()` draws an arbitrary pooled connection and would escape both the transaction and the RLS setting.
- **Repositories migrate one feature at a time.** `src/features/chatbots/server/chatbot-repository.ts` is the reference; the other nine are untouched and continue to work.
- **SQL-shaped queries stay SQL.** Date-window aggregates, `generate_series` zero-fill and full-text ranking are clearer as strings than as builder calls.
- **`drizzle-kit generate` writes to `drizzle/` for review, never into `src/server/db/migrations/`.** `drizzle-kit push` is not wired up at all.

## Consequences

- Row mapping and query shape are now compiler-checked, and a dynamic `where` can be built once and shared by a page query and its count, removing a class of bug the old positional-parameter slicing allowed.
- `tests/unit/schema-drift.integration.test.ts` compares every table, column, type, nullability and enum against the live database in both directions. It found, on its first run, that the local database was two migrations behind.
- Generated migrations must always be read before use. drizzle-kit cannot see RLS policies or triggers, so it can propose dropping things it does not know exist. The staging directory and its README exist to make that review unavoidable.
- `drizzle-kit` carries a moderate **dev-only** advisory through a bundled `esbuild <= 0.24.2`: that esbuild's dev server can be read cross-origin. drizzle-kit never starts one and never ships to production. The only npm-offered remediation is drizzle-kit 0.18.1, which is incompatible with drizzle-orm 0.45. Accepted knowingly; recorded in `docs/dependencies.md`.
- **Tenant isolation is unchanged.** An ORM is a typing and mapping improvement, not a security control. A `select()` with a forgotten `where` is exactly as dangerous as a `SELECT` with one, which is why explicit `workspace_id` filters and forced RLS both remain mandatory (ADR 0002).
