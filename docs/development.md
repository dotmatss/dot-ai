# Development

## Prerequisites

- Node.js 22+
- PostgreSQL 16 running locally

## Setup

```bash
pnpm install
cp .env.example .env.local        # then set DATABASE_URL to your local PostgreSQL
createdb dot                      # or create the database with pgAdmin / psql
pnpm db:migrate                   # applies src/server/db/migrations/*.sql
pnpm dev                          # http://localhost:3000
```

Sign up at `/sign-up`; the first account creates an organization and workspace and becomes its owner. The mock AI gateway answers in the playground and widget without external calls.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Next.js dev server (Turbopack) |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm verify` | **Preferred check.** Lock-protected `next typegen` → `tsc` → ESLint → Vitest |
| `pnpm typecheck` | `tsc --noEmit` (run `pnpm exec next typegen` first if you added routes) |
| `pnpm lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `pnpm test` / `pnpm test:watch` | Vitest unit + component tests |
| `pnpm test:e2e` | Playwright journeys (`pnpm exec playwright install chromium` once; starts the dev server if needed) |
| `pnpm db:migrate` | Apply pending migrations; `--status` lists them |
| `pnpm db:seed` | Demo tenant with chatbots, agents, knowledge, MCP servers, workflows, CRM, conversations and a pending invitation (development only). `SEED_RESET=1` rebuilds it |
| `pnpm db:generate` | Diff `src/server/db/schema/` and write SQL to `drizzle/` **for review** — never applies anything |
| `pnpm db:check` | Validate the drizzle snapshots are consistent |

### Verifying safely

`pnpm verify` exists because `next typegen` and incremental `tsc` write into shared generated directories. Two concurrent runs — a second terminal, a running dev server, or a parallel agent — interleave those writes and leave corrupt files in `.next/**` that fail as syntax errors inside generated code. The script serializes runs with an on-disk lock, disables incremental compilation, and can report only the problems you care about:

```bash
pnpm verify                                                    # whole project
node scripts/verify.mjs --scope src/features/crm --tests crm      # only CRM problems
node scripts/verify.mjs --scope src/features/intelligence --tests intelligence   # only Conversation Intelligence
node scripts/verify.mjs --skip-tests --skip-lint                  # types only
```

If generated types ever do get corrupted, stop the dev server, delete `.next`, and run `pnpm verify` again.

### Database-backed tests

A few tests exercise real SQL (tenant scoping, persistence, metering). They skip themselves when `DATABASE_URL` is unset, so the default suite needs no database:

```bash
DATABASE_URL="postgresql://postgres:<password>@localhost:5432/dot" pnpm exec vitest run chatbot-chat
```

Such tests must create their own fixtures under a unique suffix and delete them afterwards (deleting the organization cascades), and must close the pool in `afterAll`. Server modules import the `server-only` marker package; Vitest aliases it to an empty module (see `vitest.config.mts`), so services, repositories and pipelines can be unit tested directly while the Next.js build still enforces the real boundary.

## Migrations

Forward-only SQL files in `src/server/db/migrations/`, applied in lexical order inside a transaction and recorded in `schema_migrations`. Never edit an applied migration; add a new numbered file. New tenant tables must include `workspace_id` and an RLS policy like the ones in `0001_initial.sql`.

### Changing the schema

1. Edit the TypeScript in `src/server/db/schema/`.
2. `pnpm db:generate` — writes a diff into `drizzle/`. Nothing is applied.
3. Read the diff and delete anything spurious. drizzle-kit cannot see Row Level Security, the `set_updated_at` triggers, the `citext`/`pgcrypto` extensions or our expression indexes, so it may propose dropping things it does not know exist.
4. Copy the reviewed statements into a new `src/server/db/migrations/NNNN_<feature>.sql` and append the RLS block from `docs/feature-conventions.md` for any new tenant table.
5. `pnpm db:migrate`, then run the `schema-drift` and `rls` tests with `DATABASE_URL` set to prove the TypeScript, the database and the isolation policies all still agree.

`drizzle-kit push` is deliberately not wired up: it writes to the database straight from TypeScript and would drop every policy and trigger that lives only in SQL.

## Conventions

See `docs/feature-conventions.md` for the feature-module layout, security rules and verification steps every feature follows. Architecture decisions are recorded in `docs/adr/`.
