# drizzle-kit staging

Generated output lands here. **Nothing in this directory is ever applied.**

`pnpm db:migrate` applies `src/server/db/migrations/*.sql` in lexical order.
drizzle-kit writes here instead so its output cannot be picked up by that runner
before a human has read it.

## Changing the schema

1. Edit the TypeScript in `src/server/db/schema/`.
2. `pnpm db:generate` — writes a diff here.
3. Read the diff. Delete anything spurious. drizzle-kit does not know about
   Row Level Security, the `set_updated_at` triggers, the `citext`/`pgcrypto`
   extensions or our expression indexes, so it can propose dropping things it
   simply cannot see.
4. Copy the reviewed statements into a new
   `src/server/db/migrations/NNNN_<feature>.sql`, and append the RLS block from
   `docs/feature-conventions.md` for any new tenant table.
5. `pnpm db:migrate`, then `pnpm exec vitest run schema-drift rls` to prove the
   TypeScript, the database and the isolation policies all still agree.

`drizzle-kit push` is deliberately not wired up: it mutates the database
directly from the TypeScript, which would silently drop every policy and
trigger that lives only in SQL.

`0000_baseline.sql` records the state as of the Drizzle adoption. It is a
snapshot anchor, not something to run.
