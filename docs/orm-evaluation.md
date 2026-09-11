# ORM evaluation — decided: Drizzle ORM

**Status: APPROVED AND ADOPTED.** `drizzle-orm` and `drizzle-kit` are installed. **No table, column, index, policy or row was changed by the adoption** — `src/server/db/schema/` describes the database that already existed, and `tests/unit/schema-drift.integration.test.ts` proves it against the live database on every run.

The evaluation below is kept as written, so the decision can still be read against the evidence it was made on. What actually happened is recorded in [§4](#4-what-was-actually-done).

## 1. What the data access looks like today

| Fact | Count |
| --- | --- |
| Repository modules (`src/features/*/server/*-repository.ts`) | 10 |
| Query call sites (`query` / `queryOne`) | ~158 |
| Functions that accept an optional transaction client | 71 |
| `withWorkspace()` (RLS-scoped transaction) call sites | 25 |
| Migrations / tables | 6 files, 25 tables |

The boundary is already clean and narrow:

- `src/server/db/client.ts` owns the pool, `query`, `queryOne`, `withTransaction`, `withWorkspace`, and error translation.
- `src/server/db/sql.ts` owns pagination, `ParamBuilder`, `likePattern` and timestamp mapping.
- Repositories write explicit SQL and map rows to serializable domain types. Services hold business rules. Nothing above the repository layer knows the driver exists.

Five characteristics constrain the choice more than any feature comparison:

1. **RLS is enforced through a transaction-local setting.** `withWorkspace()` runs `SELECT set_config('app.workspace_id', $1, true)` and then the caller's statements **on that same connection**. Any candidate must expose a bound transaction handle, not just an auto-committing client.
2. **Migrations carry things no ORM schema language expresses**: `ENABLE`/`FORCE ROW LEVEL SECURITY`, policies with a cast-safe `nullif(...)` predicate, `citext`/`pgcrypto` extensions, enum types, an `updated_at` trigger, partial unique indexes, and a GIN index on `to_tsvector('english', content)`.
3. **Some queries will never be expressible in a query builder**: RAG retrieval uses `plainto_tsquery` + `ts_rank_cd` + `ts_headline` with a chunk/source fallback union; analytics zero-fills buckets with `generate_series` + `date_trunc`. These must survive as raw SQL with no loss of type safety.
4. **The build and test story matters.** `server-only` guards the boundary; Vitest imports repositories directly. A required codegen step before typecheck would add friction to every clone, CI run and agent.
5. **The stated infrastructure direction is Cloudflare / GCP**, so an engine binary or a proprietary connection proxy is a liability.

## 2. Candidates

### Drizzle ORM — recommended

TypeScript schema, SQL-shaped query builder, migrations emitted as plain `.sql`.

- **Type safety:** inferred end-to-end from the schema, including `sql<T>` raw fragments. No codegen step; types come from the TS schema itself.
- **PostgreSQL:** first class — jsonb, arrays, enums, partial indexes, `ON CONFLICT`, CTEs, window functions.
- **Next.js:** pure TypeScript, no binary, no `serverExternalPackages` juggling; works on Node and on edge runtimes with HTTP drivers, which matches the Cloudflare direction.
- **Migrations:** `drizzle-kit generate` writes SQL files we review and extend by hand. Our RLS and trigger blocks live in the same file as the generated DDL — one artifact, still fully expressive. The existing `scripts/migrate.mjs` runner can keep applying them.
- **Query flexibility:** the builder covers CRUD and joins; `sql` templates cover the rest, and the two compose in one statement. Our retrieval and analytics queries move over unchanged.
- **Transactions:** `db.transaction(async (tx) => …)` hands over a bound client, so `withWorkspace()` becomes a three-line wrapper.
- **Performance:** a thin layer over `pg`; no engine process, no N+1 hidden behind lazy relations.
- **Maturity:** younger than Prisma, but stable and widely used in production since 2024. The API churn was mostly pre-0.30.
- **Multi-tenant fit:** best of the group, because it does not fight the transaction-scoped RLS pattern.
- **Cost:** relational query helpers are less powerful than Prisma's; complex aggregates still need raw SQL (which we already write); `drizzle-kit pull` will not reproduce RLS policies, so those stay hand-authored.

### Kysely — close runner-up

A pure type-safe query builder, no ORM semantics.

Excellent match for a codebase that already thinks in SQL, and the lightest possible abstraction. It loses to Drizzle on leverage: no schema as source of truth, no relational loading, and migrations are authored in TypeScript, which is a step backwards for us because our migrations are deliberately reviewable SQL with policy blocks. Choose Kysely if the goal is purely "typed SQL"; choose Drizzle if the goal also includes replacing hand-written row mapping.

### Prisma — not recommended here (and out of scope without your approval)

Best-in-class DX for ordinary CRUD and the best documentation of the group. Against it, for this codebase specifically:

- Its schema language cannot express RLS, `FORCE`, policies, triggers or our extensions, so those live in raw migration SQL anyway — two sources of truth instead of one.
- A `prisma generate` step must run before typecheck, on every clone and CI job.
- Transaction-scoped `set_config` for RLS requires interactive transactions plus a client extension; it is workable but it is the pattern Prisma is least comfortable with, and it interacts badly with external connection poolers.
- Complex aggregates fall back to `$queryRaw`, which drops most of the type safety that motivated adopting it.
- Heavier runtime and deployment story on edge/serverless without Accelerate or driver adapters.

### TypeORM — not recommended

Decorator and ActiveRecord patterns clash with our functional repositories, inference is weaker than the alternatives, migration generation is unreliable, and maintenance has been uneven.

### Also considered

- **MikroORM** — solid and genuinely well-typed, but its Unit of Work / identity-map model is a heavier mental model than this codebase needs, and request-scoped entity managers are awkward in serverless.
- **Sequelize** — TypeScript support is retrofitted; no.
- **postgres.js / @databases** — drivers, not ORMs. `postgres.js` is a credible faster replacement for `pg` *underneath* Drizzle later; it does not answer this question.

## 3. Recommendation

**Adopt Drizzle ORM, keep the existing data-access boundary, and migrate feature by feature.** Kysely is the fallback if the team prefers zero ORM semantics.

The reason is not query ergonomics — it is that Drizzle is the only candidate that improves type safety and row mapping **without taking ownership of the schema away from SQL**, which this application cannot give up while tenant isolation lives in RLS policies.

### Adoption plan (approved)

1. Add `drizzle-orm` + `drizzle-kit` as dependencies; keep `pg` as the driver (`drizzle-orm/node-postgres`).
2. Describe the existing 25 tables in `src/server/db/schema/` — bootstrapped with `drizzle-kit pull`, then hand-checked against the migrations. **No schema change, no data migration**: the TS schema describes what already exists.
3. Reimplement `query`, `queryOne`, `withTransaction` and `withWorkspace` on top of Drizzle's pool and transaction handle, keeping their current signatures. **Zero repository changes on day one**, and the RLS integration test keeps proving isolation.
4. Going forward, author schema changes in TS, run `drizzle-kit generate`, then extend the emitted SQL with the RLS block from `docs/feature-conventions.md` before committing. The existing runner applies it; migration files stay reviewable SQL.
5. Migrate repositories one feature at a time, starting with chatbots as the reference. Retrieval and analytics queries stay as `sql` templates on purpose.
6. Add a test that asserts the TS schema matches the live database (`drizzle-kit check` or an introspection diff), so the two cannot drift.

### What this does *not* change

Tenant isolation stays exactly as it is: explicit `workspace_id` filters plus forced RLS. An ORM is a typing and mapping improvement, not a security control — a `findMany` with a forgotten filter is exactly as dangerous as a `SELECT` with one.

## 4. What was actually done

Steps 1–3 and 6 are complete. Step 5 is deliberately incremental.

| Step | State | Detail |
| --- | --- | --- |
| 1. Install | Done | `drizzle-orm` (zero transitive dependencies) and `drizzle-kit` (dev only). `pg` remains the driver, through `drizzle-orm/node-postgres`. The dev-only advisory carried by drizzle-kit is recorded in `dependencies.md` |
| 2. Describe the schema | Done | `src/server/db/schema/` — 25 tables, 13 enums, the `citext` custom type, transcribed by hand from the migrations |
| 3. Keep the boundary | Done | `query`, `queryOne`, `withTransaction` and `withWorkspace` are **unchanged**. `client.ts` additionally exports `getDb()`, `dbFor(client)` and `withDb(fn, client?)` |
| 4. Future schema changes | Wired | `npm run db:generate` writes to `drizzle/` for review; the reviewed SQL is copied into a numbered migration with the RLS block appended. `drizzle-kit push` is deliberately **not** wired up |
| 5. Migrate repositories | 1 of 10 | `src/features/chatbots/server/chatbot-repository.ts` is the reference. The other nine still use `query`/`queryOne` and work exactly as before |
| 6. Prove no drift | Done | `tests/unit/schema-drift.integration.test.ts` compares every table, column, type, nullability and enum — in both directions — against the live database |

### Why `withDb` exists

`withWorkspace()` sets `app.workspace_id` on **one connection**, and only statements on that connection see it. `getDb()` draws an arbitrary connection from the pool, so calling it inside a workspace transaction would escape both the transaction and the RLS scope. `dbFor(client)` binds Drizzle to the transaction's own connection, and `withDb(fn, client?)` picks the right one while preserving the existing error translation — unique violations still become 409s, connection failures still become `DatabaseUnavailableError`.

### What the adoption surfaced

Writing the schema description and testing it against the database found that the local database was two migrations behind (`0010_crm`, `0011_integrations`), so `integration_secrets` did not exist. Applying them fixed it. That is the drift test earning its place on day one.

### What is still true

Tenant isolation is unchanged: explicit `workspace_id` filters plus forced RLS. An ORM is a typing and mapping improvement, not a security control — a `findMany` with a forgotten filter is exactly as dangerous as a `SELECT` with one.
