# Drizzle ORM migration plan and progress

**Status:** complete  
**Owner:** database architecture migration  
**Last updated:** 2026-09-15

## Goal

Make Drizzle ORM the default PostgreSQL access layer for normal CRUD, joins,
filters, ordering, pagination, aggregations, and transactions. Raw SQL remains
only where a concrete PostgreSQL feature or query shape cannot be reasonably
expressed through Drizzle.

The migration must preserve the existing server boundary, service and
repository responsibilities, explicit workspace filters, and transaction-local
RLS setting (`app.workspace_id`). It must not introduce a second connection,
ORM, or query builder, and it must not change database schema or existing
migrations unless a schema change is independently required.

## Outcome

Every database-accessing module now reaches PostgreSQL through Drizzle for
ordinary work. Twenty-three statements remain hand-written, each one because a
specific PostgreSQL construct has no builder form; all are listed and justified
in [Classified raw SQL](#classified-raw-sql-that-remains) below. No schema, no
migration and no exported repository signature changed as a result of this work.

## Current architecture confirmed

- `src/server/db/client.ts` owns the one `pg` pool and the Drizzle instance.
- `getDb()` uses that pool; `dbFor(client)` binds Drizzle to the active `pg`
  connection for work inside an existing transaction.
- `withDb()` retains the database error contract while selecting the correct
  Drizzle handle.
- `withWorkspace()` sets the RLS workspace setting on its transaction
  connection. Repository changes continue to use the transaction-bound Drizzle
  handle when invoked from this boundary.
- The schema source is `src/server/db/schema/`; Drizzle Kit writes reviewed
  staging output to `drizzle/`, while production migrations remain under
  `src/server/db/migrations/`.

## Work plan

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Inventory every database-accessing module and classify all raw SQL and driver APIs. | Complete |
| 2 | Define a transaction-compatible Drizzle repository interface and retire obsolete client abstractions only after all consumers move. | Complete |
| 3 | Migrate ordinary repository CRUD, joins, filters, sort order, and pagination in small, reviewable feature groups. | Complete |
| 4 | Convert manual transaction control to Drizzle transactions where this preserves RLS behavior. | Complete |
| 5 | Classify, justify, and document raw SQL that remains for PostgreSQL-specific or otherwise unsupported queries. | Complete |
| 6 | Remove dead SQL constants, row-only mappers, wrappers, types, and imports. | Complete |
| 7 | Run typecheck, lint, unit/integration tests, and the final repository-wide search. | Complete |

## Progress log

| Date | Completed work | Evidence / result |
| --- | --- | --- |
| 2026-09-13 | Created this execution plan and began the repository-wide inventory. | Existing configuration, schema location, and database boundary inspected. |
| 2026-09-13 | Migrated agent-execution writes, the shared workspace usage writer, the shared activity writer, and the platform audit writer to typed Drizzle inserts and updates. | `pnpm typecheck` passes after the conversion. Agent execution identifiers are generated with `randomUUID()` so a root execution can safely reference itself before insert. |
| 2026-09-13 | Updated the CRM service's transaction-helper type where it hands the transaction-bound client to the migrated activity writer. | Preserves use of the same RLS-scoped connection. |
| 2026-09-13 | Migrated the API-key repository's list/count, lookup, insert, revoke, credential join, and last-used update operations to Drizzle. | `pnpm typecheck` passes. The active-before-revoked ordering is retained with a typed SQL boolean expression inside the Drizzle order clause. |
| 2026-09-13 | Migrated the audit repository's filtered listing, count, recent entries, and filter facets to Drizzle. | Workspace predicates, nullable actor joins, date bounds, ordering, pagination, and bigint id serialization are preserved. |
| 2026-09-13 | Migrated server session creation, resolution, sliding refresh, expiry cleanup, and revocation to Drizzle. | The active-user predicate remains part of the insert-select and lookup join, preserving the authentication boundary. |
| 2026-09-13 | Migrated external-identity linking, user creation, identity upsert, and default-workspace lookup in the auth service to Drizzle. | The active-user checks, conflict-safe identity insert, organization status filter, and oldest-workspace ordering are preserved. |
| 2026-09-13 | Migrated the workspace repository's membership, organization, slug, workspace, role, and default-workspace operations to Drizzle. | Active-organization filtering, membership roles, ordering, and transaction-bound slug allocation are preserved. `DatabaseClient` now supports either the shared pool or a checked-out transaction client for Drizzle callers. |
| 2026-09-13 | Migrated embed preview authorization from raw SQL to a typed workspace-membership join. | The app-origin preview path still requires an editable member role. |
| 2026-09-13 | Migrated authentication DAL user/session lookup, workspace membership resolution, lifecycle guards, and platform-admin grant lookup to Drizzle. | Disabled-user checks, organization status handling, membership role resolution, and revoked-grant exclusion remain explicit. Updated Vitest mocks to represent the new `withDb` boundary. |
| 2026-09-13 | Completed the auth service migration for password authentication and both registration paths. | Active-user filtering, password-hash behavior, transactional user creation, organization/workspace creation, and invitation claims are preserved. |
| 2026-09-13 | Migrated both workflow repositories: workflow list/detail/insert/patch/delete and run list/detail/insert/finish. | The last-run lateral join is preserved with Drizzle's `leftJoinLateral`; run listings still carry `jsonb_array_length` rather than the step payload. |
| 2026-09-13 | Migrated the integration repository, including the provider upsert and the sealed-credential upsert. | Both `ON CONFLICT` targets are expressed through `onConflictDoUpdate`; the secret join remains constrained on integration id **and** workspace id. |
| 2026-09-13 | Migrated the settings repository and the invitation service's organization lock. | `FOR UPDATE` and `FOR SHARE` are expressed with Drizzle's `.for()`, so the last-owner and double-accept races stay serialized. Member ordering keeps its role-rank `CASE`. |
| 2026-09-13 | Migrated the platform repository's organization and user listings, details, identity locks, status writes, session deletion, and the platform audit log. | Cross-tenant reads still select columns by name; `tests/unit/platform-isolation.test.ts` passes unchanged, including its credential-column grep. |
| 2026-09-13 | Migrated the conversation repository: inbox list with its search `EXISTS`, detail, messages, appends, patches, and the contact/assignee guards. | `DESC NULLS LAST` is written explicitly, since Drizzle's `desc()` would otherwise float never-messaged threads to the top of the inbox. |
| 2026-09-13 | Migrated the CRM contact repository: contacts, notes, activities, per-contact conversations, and AI summary material. | Tag filtering uses `arrayContains`, preserving the `@>` containment the GIN index serves. |
| 2026-09-13 | Migrated the agent repository, including delegation grants and candidates. | `setAgentDelegations` keeps its disable-the-rest semantics: `notInArray` with an empty list is the constant true, exactly as `<> ALL('{}')` was. |
| 2026-09-13 | Migrated the knowledge repository: collections, documents, chunk replacement, status rollups, and the cross-table move. | `moveSourceToCollection` still runs both updates on the `withWorkspace` connection, so the denormalized `collection_id` on chunks cannot drift. |
| 2026-09-13 | Migrated the ordinary halves of the dashboard, analytics and platform overview services, and the chatbot repository's last ordinary read. | Tile counters and time-series grids stay raw for the reasons recorded below; everything with a real `FROM` is now a Drizzle query. |
| 2026-09-13 | Migrated the embed deployment read model. | The widget counters keep their single lateral pass via `leftJoinLateral`. |
| 2026-09-13 | Migrated the AI registry repository (migration 0024) and the abuse-prevention store (migration 0025), both of which landed during this work. | The registry's partial updates now build their `SET` list from present keys, retiring the paired `COALESCE` / `CASE WHEN $n::boolean` flags. `tests/unit/ai-registry.test.ts` still confirms only the two credential functions name the sealed columns. |
| 2026-09-13 | Retired `Queryable` from every consumer; repository client parameters are now `DatabaseClient` (pool or transaction client). | No module outside `src/server/db/client.ts` references the type. |
| 2026-09-14 | Ran the 16 integration suites against live PostgreSQL for the first time since the migration, and fixed what they found. | See **The bug the unit tests could not see** below. All 118 test files and 1,447 tests now pass with `DATABASE_URL` set; nothing is skipped. |
| 2026-09-14 | Taught `schema-drift.integration.test.ts` to compare type MODIFIERS, not just base type names. | It compared Drizzle's rendered `numeric(12, 4)` against PostgreSQL's `udt_name`, which is always the bare `numeric`. `numeric` is the schema's first parameterised type (migration 0024), so this was its first false positive. The live side now rebuilds the modifier from `numeric_precision` / `numeric_scale`, which makes a cost column silently losing decimal places a failure rather than a shrug. |
| 2026-09-14 | Added `tests/unit/correlated-subquery.test.ts`. | A source-level guard against the bug below. Verified it fails when the banned shape is reintroduced, rather than merely passing today. |
| 2026-09-15 | Fixed `ORDER BY` over select aliases in `getChatbotPerformance` and `getMessagesByChatbot`, reported as a production runtime error. | See **The second one, which reached production** below. Both now carry `.as()`; verified by reverting the fix and watching the new suite reproduce the exact reported error. |
| 2026-09-15 | Added `tests/unit/migrated-reads.integration.test.ts`. | Executes all 21 migrated dashboard, analytics, platform and embed reads against a real database. These had no persistence suite of their own, which is why both defects survived to this point. |
| Before this plan | Installed and configured Drizzle over the existing `pg` pool; described the existing schema; added schema-drift verification; migrated the chatbot repository as the reference implementation. | Recorded in `docs/orm-evaluation.md`. |

## Migration rules

1. Use schema columns and Drizzle operators for normal operations. Preserve each
   original join type, predicates, ordering, selected aliases, default values,
   limit/offset behavior, and return contract.
2. Keep explicit workspace, organization, tenant, and user filters. RLS is a
   defense in depth measure and does not replace these predicates.
3. Select named fields with application-oriented aliases where that removes a
   raw-row-only mapping step. Keep mappers that perform domain transformation.
4. Use a Drizzle transaction or a transaction-bound database handle for work
   that must remain atomic. Do not obtain an independent pooled connection from
   inside a workspace transaction.
5. Keep raw SQL only with a documented technical justification, using Drizzle's
   `sql` support where it needs to compose with a Drizzle query.
6. Do not modify production migrations for an implementation-only query change.

## Classified raw SQL that remains

Twenty-five statements. Each is annotated in place, and each falls into one of
four shapes the builder genuinely cannot express. Nothing here is raw merely
because it was already written.

### 1. A set-returning function in the `FROM` clause

Drizzle's `from()` takes a table or a subquery. It cannot name
`generate_series`, `unnest`, or `enum_range`, and these queries exist precisely
to produce rows the tables do not contain — the zero buckets, the unused
channel, the untouched metric.

| Statement | Construct |
| --- | --- |
| `analytics-service.ts` — `BUCKET_GRID` (used by 3 statements) | `generate_series` via `CROSS JOIN LATERAL` |
| `analytics-service.ts` — `getChannelMix` | `unnest(enum_range(NULL::conversation_channel))` |
| `analytics-service.ts` — `getUsageTotals` | `unnest($3::text[])` |
| `dashboard-service.ts` — `getUsageSummary` daily series | `generate_series` day grid |
| `contact-repository.ts` — `listContactTags` | `unnest(c.tags)` |
| `protection/store.ts` — `ACQUIRE_SQL` | `generate_series` slot enumeration |

### 2. Several unrelated scalar aggregates in one round trip

These are `SELECT`s with no `FROM` at all (or a one-row `win` CTE). Expressed
through the builder each becomes one statement per number: nine concurrent
statements for the platform overview and a dozen for the dashboard, against a
pool of ten. The batching is the point.

| Statement | Figures returned |
| --- | --- |
| `platform-overview.ts` — organization/workspace counters | 5 |
| `platform-overview.ts` — build counters | 4 |
| `dashboard-service.ts` — `getDashboardStats` | 10 |
| `dashboard-service.ts` — `getKnowledgeStatus` | 6 |
| `dashboard-service.ts` — `getWorkflowActivity` counters | 4 |
| `dashboard-service.ts` — `getCrmActivity` counters | 4 |
| `analytics-service.ts` — `getAnalyticsKpis` | 10 |
| `analytics-service.ts` — `getWorkflowRunsSummary` | 6 |
| `analytics-service.ts` — `getCrmGrowth` totals | 3 |
| `agent-repository.ts` — `getAgentOverview` windows | 4 |
| `chatbot-repository.ts` — `getChatbotOverview` windows | 4 |

### 3. Full-text search

`retrieval.ts` — `retrieveKnowledge`. `plainto_tsquery`, rewriting the parsed
`tsquery`, `ts_rank_cd`, `ts_headline` and the `@@` match operator *are* the
query; there is nothing incidental left for a builder to hold.

### 4. Statement shapes with no builder equivalent

| Statement | Construct |
| --- | --- |
| `contact-repository.ts` — `TIMELINE_SOURCE` (2 statements) | Three-branch `UNION ALL` with per-column type coercion so the branches align |
| `knowledge-repository.ts` — `setChunkEmbeddings` | `UPDATE … FROM (VALUES …)`: a different value per row in one statement |
| `protection/store.ts` — `ACQUIRE_SQL` | Also: `ON CONFLICT ON CONSTRAINT <name>` and a `DO UPDATE … WHERE`, which is what makes over-allocation unrepresentable |
| `analysis-source.ts` — `listConversationsForAnalysis` | `JOIN LATERAL` producing four per-thread facts in one pass: `FILTER` aggregates, a correlated `LIMIT 1`, and a `jsonb_typeof` guard before `jsonb_array_length` |
| `intelligence-repository.ts` — `recomputeTopicCounters` | `UPDATE … FROM (SELECT … GROUP BY)` with `FILTER` aggregates: every topic's counters rebuilt from its insights in one statement |

### A note on parameter typing, added by 0027

Two predicates in `intelligence-repository.ts` carry explicit
`::double precision` casts, and they are not decoration. Interpolating a JS
number next to an `integer` column makes PostgreSQL infer the parameter as
`integer` too, so a threshold of `0.5` fails at runtime with `22P02` on a query
that type-checks perfectly. The integration suite caught it; nothing else
could.

## The bug the unit tests could not see

Worth recording in full, because the migration shipped it and the entire unit
suite was green throughout.

**What happened.** Drizzle renders an interpolated column inside a `sql`
template *without* its table name when the enclosing query has no join. Every
correlated subquery written as a template was therefore wrong:

```ts
sql`(SELECT count(*) FROM ${contactNotes} WHERE ${contactNotes.contactId} = ${contacts.id})`
```

rendered as

```sql
(SELECT count(*) FROM "contact_notes" WHERE "contact_id" = "id")
```

Both names resolve against `contact_notes` itself, so the subquery compared a
row to itself. No error, no warning — the count simply came back `0`.

**Why nothing caught it.** The unit suite mocks the database boundary, so it
never renders SQL. Typecheck cannot see inside a template. The one assertion in
the repository that would have failed — `noteCount` — lives in an integration
test that only runs with `DATABASE_URL` set, and those 16 files had been
skipping since before the migration began.

**Blast radius.** Nine selections across seven modules: CRM contact detail,
knowledge collection rollups, agent counts and delegate ids, platform
organization/workspace/user counts, dashboard chatbot performance, and the AI
registry's `credentialConfigured` — which would have reported every provider as
having no credential. Two of them, in `chatbot-repository.ts`, were **not**
introduced by this migration: they were in the reference implementation from the
start and had been wrong in production since it landed.

**The fix.** Compose subqueries with the query builder and interpolate the
result; the builder always qualifies, join or no join. Two further subqueries
that were *accidentally* correct — safe only because their query happened to
have a join — were converted too, so the rule holds uniformly rather than
depending on the enclosing query's shape.

**The lesson worth keeping.** A mocked boundary proves the code calls the
database; it cannot prove it asks the right question. The integration suite is
the only thing here that does, and it must be run.

## The second one, which reached production

The same blind spot produced a second defect, and this one was reported as a
runtime error from the dashboard rather than found by a test.

**What happened.** Drizzle does not emit an `AS` clause for a select-list field
— it maps result rows structurally, so it has no need to. Two queries were
migrated with an `ORDER BY` that referenced a select alias, as the hand-written
SQL had:

| Query | `ORDER BY` | Result |
| --- | --- | --- |
| `getChatbotPerformance` | `conversations DESC` | `column "conversations" does not exist` — the dashboard threw |
| `getMessagesByChatbot` | `messages DESC` | **No error.** `messages` is also a table in that query's `FROM`, so PostgreSQL bound it to that table's whole-row composite and sorted by it — the analytics table was quietly ordered by nothing meaningful |

The second is the more instructive one: identical mistake, no symptom.

**The fix.** `.as("conversations")` / `.as("messages")` on the expression, which
makes Drizzle emit the alias the `ORDER BY` refers to. Ordering by the output
name keeps the subquery evaluated once, which repeating the expression in the
`ORDER BY` would not.

**Why the earlier verification missed it.** The generated SQL was checked by
rendering it and asserting the `ORDER BY` text appeared — which it did. What was
never asserted is that the alias it referred to was emitted. Rendering proves
the string is what you expected; only the server can tell you it is *valid*.

**The coverage gap behind both defects.** The dashboard, analytics and
platform-overview services own no table, so no feature persistence suite
touches them — every statement in them was unexercised.
`tests/unit/migrated-reads.integration.test.ts` now executes each one against a
real database and asserts almost nothing about the results, because validity was
the property that was missing.

## Completion report

| Measure | Result |
| --- | --- |
| Database-access modules migrated across the whole migration | 30 |
| Modules migrated in this final phase | 17, plus 3 services retyped off `Queryable` |
| Raw SQL call sites converted to Drizzle | 144 in tracked files, plus the two modules that landed untracked during the work |
| Raw SQL statements remaining | 23, every one classified above |
| Modules still holding at least one exception | 9 |
| Obsolete abstractions removed | `Queryable` is no longer referenced outside `src/server/db/client.ts`, where it types the two surviving raw helpers. `ParamBuilder` is retained: `setChunkEmbeddings` is the one remaining statement that still builds a dynamic positional parameter list. |
| Behavior or security concerns discovered | Two rendering defects, both documented above: correlated subqueries losing table qualification, and `ORDER BY` over a select alias Drizzle never emitted. Both fixed and guarded. RLS connection affinity remains a mandatory constraint and is preserved everywhere. Two ordering details needed explicit handling: PostgreSQL defaults `DESC` to `NULLS FIRST`, so `DESC NULLS LAST` is written out in the inbox and overview lists rather than relying on `desc()`. `citext` columns keep an explicit `::text` cast where a pattern match is performed against them. |
| Validation | `pnpm typecheck` — passed. `pnpm lint` — passed, no warnings. `pnpm test` with `DATABASE_URL` set — **120 files, 1,453 tests, all passing, none skipped**, including all 16 integration suites against live PostgreSQL. `platform-isolation`, `ai-registry` and `schema-drift` all pass, which is what confirms the cross-tenant projections did not widen, the credential columns are still named in exactly two functions, and the schema description still matches the real database down to numeric precision. |

### Known follow-ups, out of scope for this migration

- `listChatbots` builds its search pattern as `` `%${filters.q}%` `` rather than
  through `likePattern()`, so a user-supplied `%` or `_` still acts as a
  wildcard there. Every other list in the codebase escapes them. Pre-existing
  and behavior-affecting, so it was not changed as part of an
  implementation-only migration.
- `listContactConversations` joins `chatbots` and `agents` on id alone, while
  the inbox's equivalent join also constrains `workspace_id`. Preserved as
  written; worth reconciling separately.
