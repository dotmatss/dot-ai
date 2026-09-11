# Feature module conventions

Every product domain lives in `src/features/<feature>/` and follows the same layered shape. The **chatbots** feature is the reference implementation; copy its structure rather than inventing a new one.

```text
src/features/<feature>/
  types.ts          client-safe domain contracts (dates are ISO strings, never Date)
  constants.ts      status metadata (label + badge tone), defaults, option lists
  schemas.ts        Zod schemas shared by forms (client) and route handlers (server)
  filters.ts        URL param → list filter normalizer (shared by server page + client list)
  api.ts            typed client fetchers built on apiFetch(); one object per domain
  queries.ts        query keys + queryOptions factories + useXQuery hooks (no "use client")
  mutations.ts      useXMutation hooks: invalidate keys, toast, optimistic updates where cheap
  server/
    <x>-repository.ts   SQL only ("server-only"); explicit workspace_id filters; row → domain mappers
    <x>-service.ts      business rules, activity log, transactions via withWorkspace()
  components/       UI (client components only when interactive)
```

Routes:

```text
src/app/w/[workspaceSlug]/<feature>/page.tsx            list (Server Component: prefetch + HydrateClient)
src/app/w/[workspaceSlug]/<feature>/loading.tsx
src/app/w/[workspaceSlug]/<feature>/[id]/layout.tsx     detail shell: header + AppTabNav, seeds detail query
src/app/w/[workspaceSlug]/<feature>/[id]/<tab>/page.tsx thin pages that render one client component
src/app/api/v1/w/[workspaceSlug]/<feature>/route.ts     GET list, POST create
src/app/api/v1/w/[workspaceSlug]/<feature>/[id]/route.ts GET, PATCH, DELETE
```

## Rules

**Security**
- Every route handler is wrapped in `workspaceRoute(handler, { minimumRole })` from `src/server/http/workspace-route.ts`. Reads: `viewer`. Writes: `member`. Destructive / admin actions: `admin`.
- Every page calls `requireWorkspaceAccess(workspaceSlug)` (from `src/server/auth/dal.ts`) and uses `membership.workspace.id` for data access. Never trust ids from the client for tenancy.
- Repository SQL always filters on `workspace_id = $n`. Multi-statement writes run inside `withWorkspace(workspaceId, client => ...)`.
- Validate every request body with `parseJsonBody(request, schema)` and query strings with `parseSearchParams`.
- Never read `process.env` outside `src/config/env.ts`. Never expose secrets, instructions, or internal identifiers to public endpoints.

**Data**
- Domain types are serializable: `string` ISO dates via `toIsoRequired` / `toIso` from `src/server/db/sql.ts`.
- Paginated lists return `Paginated<T>` (`src/types/pagination.ts`). Use `normalizePage`, `ParamBuilder`, `likePattern`, `toPaginated`.
- Use `ApiError` factories (`src/lib/api/api-error.ts`) for expected failures. `notFound` for missing rows in the caller's workspace.
- Record meaningful changes with `recordActivity()` (`src/server/activity/activity-log.ts`) and usage with `recordUsage*` (`src/server/usage/record-usage.ts`).
- Schema changes go in a **new** migration file `src/server/db/migrations/000N_<feature>.sql` (never edit an applied migration).
- A new tenant table carries `workspace_id` referencing `workspaces(id) ON DELETE CASCADE`, its indexes, **and all three of these**:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;   -- policies do not apply to the table owner without this
CREATE POLICY <t>_workspace_isolation ON <t>
  USING (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  WITH CHECK (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );
```

  The `nullif` is not decoration: PostgreSQL does not guarantee OR short-circuiting, so a bare `current_setting(...)::uuid` can be evaluated on the empty string that a committed `set_config(..., true)` leaves behind, failing unrelated queries on that pooled connection. See `0014_rls_policy_cast_safety.sql`. `tests/unit/rls.integration.test.ts` asserts this convention for every tenant table, so a migration that skips it fails the suite.

**Data access (Drizzle)**
- `src/server/db/schema/` describes the tables that exist. Editing it does not change the database; a migration does. `tests/unit/schema-drift.integration.test.ts` fails if the two disagree.
- Inside a `withWorkspace()` transaction, pass the client: `withDb((db) => ..., client)`. Calling `getDb()` there takes a different connection from the pool, which silently escapes both the transaction and the `app.workspace_id` setting that Row Level Security reads. This is the one Drizzle mistake that breaks tenant isolation.
- Keep writing explicit `eq(table.workspaceId, workspaceId)` on every tenant read and write. Drizzle is a typing layer, not an authorization layer.
- Build a dynamic `where` once and reuse it for the page query and the count, so the two cannot drift.
- Leave SQL-shaped queries as SQL: date-window aggregates, `generate_series` zero-fill, `ts_rank_cd` ranking. `src/features/chatbots/server/chatbot-repository.ts` is the reference for where the line falls.
- Schema changes: edit the TypeScript, `npm run db:generate`, read the diff in `drizzle/`, then copy the reviewed statements into a new numbered migration and append the RLS block below. `drizzle-kit push` is not available on purpose.

**Public surfaces**
- Anything reachable without a session is tenant-less by construction, not by checking. Give it no workspace id in its request contract, and keep its module graph away from `src/server/db`, repositories, `src/server/auth` and anything holding a credential. Assert it: `tests/unit/public-chatbot-isolation.test.ts` walks the import graph of the public demo and fails on the first forbidden edge.
- Keep error helpers free of heavy imports. `toErrorResponse()` is imported by every route, so `DatabaseUnavailableError` lives in the leaf module `src/server/db/errors.ts`; putting it in `client.ts` dragged the pool and the whole Drizzle schema into routes that never query anything.
- Load interactive public widgets on demand with `next/dynamic` and `ssr: false`, mounting the heavy component only after the first interaction. A marketing page should not ship a chat client to a visitor who never opens it.

**Theme**
- Use semantic tokens (`bg-surface`, `text-foreground-muted`, `bg-accent text-accent-foreground`), never raw ink utilities or `text-white`, or the component will be unreadable in one of the two themes. The ink scale is a fixed palette and does not flip.
- Needing a `dark:` variant means a token is missing. Add one to both `:root` and `.dark` instead.
- Charts and skeletons need tokens too: a bar track or an axis line hard-coded to a light grey disappears on a dark ground.
- The embeddable widget is deliberately exempt. It renders in the customer's brand colour on the customer's site and must not follow this application's theme. See `docs/theming.md`.

**Crossing feature boundaries**
- A feature never writes SQL over another feature's tables. If feature A needs a view of feature B's data, B exports a named read model from its own `server/` folder and A imports it. `listEmbedDeployments()` in `src/features/chatbots/server/embed-deployments.ts` is the reference: the developer area renders it, but the rules about what makes a chatbot reachable stay owned by the chatbots feature.
- Shared display metadata is imported, not copied. The settings Usage page reads `USAGE_KIND_META` from the analytics feature rather than restating the labels.
- A new developer-facing surface extends the existing area it belongs to. API keys and embeds are tabs under Integrations, not a parallel "Developer" section with its own layout, tabs and conventions.

**Client state**
- Server data: TanStack Query only. Keys: `<feature>Keys.all(slug)`, `.lists(slug)`, `.list(slug, filters)`, `.detail(slug, id)`. Server pages seed the cache with `queryClient.setQueryData(key, data)` and wrap in `<HydrateClient>`.
- URL is the source of truth for list filters: `useSearchParamState([...keys])` + `useDebouncedValue` for search.
- Forms: React Hook Form + `zodResolver`. Use `AppFormField` (render-prop supplies id/aria). Use `useWatch` instead of `form.watch`. Apply server field errors with `applyFieldErrors`.
- **Never key a form on a server timestamp.** `<Form key={data.updatedAt} …>` looks like a neat way to pick up server changes, but it remounts — and so discards whatever the user is typing — every time *any* sibling mutation touches the record, such as a status toggle in the page header. Key on the record id and reconcile instead:

```tsx
useEffect(() => {
  if (!form.formState.isDirty) form.reset(toFormValues(record));
}, [record, form]);
```

- Zustand only for UI preferences / cross-page client state. Do not put server data in Zustand.
- **Never compute a relative timestamp during render in a Client Component.** The server and the client render at different instants, so React reports a hydration mismatch and throws the markup away. Use `AppRelativeTime`, which renders the absolute date until hydration. Server Components may call `formatRelativeTime` directly.

**UI**
- Use `App*` primitives from `src/components/ui`, feedback components from `src/components/feedback`, `PageContainer` + `PageHeader` from `src/components/layout`, charts from `src/components/charts`.
- Every list/detail handles: loading (skeleton), error (`AppErrorState` with retry), empty (`AppEmptyState` with a CTA), filtered-empty ("clear filters").
- Monochrome design: ink scale for hierarchy, status tones only for semantic state, always paired with a label/icon. No new colors, fonts, radii or shadows; use tokens from `globals.css`.
- Role gating in UI is cosmetic: hide/disable controls with `canEdit(role)` / `canManage(role)`; the server re-checks.
- Accessibility: semantic elements, labelled controls, `aria-current`, focus-visible styles come from primitives. A custom role needs its own name — `<label for>` does **not** name a `role="switch"` button, so use `aria-labelledby`. Static content inside `role="menu"` is invisible to assistive technology: pass `contentRole="dialog"` to `AppDropdownMenu` for an informational popover.
- Streaming chat UI is shared: `useChatStream` + `ChatThread` + `ChatComposer`. A feature that needs richer transcript content passes a renderer (`renderToolActivity`) rather than copying the hook — an earlier copy drifted and carried three fixed bugs for a week.

**Verification** before finishing a feature:

```bash
node scripts/verify.mjs --scope src/features/<feature>,tests/unit/<feature> --tests <feature>
node scripts/verify.mjs          # whole project, before you call the work done
```

Run verification through that script rather than calling the tools directly. `next typegen` and `tsc --incremental` write into shared generated directories (`.next/types`, `.next/dev/types`, `.tsbuildinfo`), so two concurrent runs — a second terminal, a running dev server, or another engineer — interleave their writes and produce corrupt type files that fail with syntax errors in generated code. The script takes an exclusive lock, disables incremental compilation, and separates problems inside `--scope` from the rest of the project. ESLint is always run project-wide and filtered, because route directories like `src/app/w/[workspaceSlug]/…` are glob character classes on the command line.

For the same reason, do not leave `next dev` running while verifying, and never run two verifications without the lock.

Add unit tests for schemas, filter parsing and any non-trivial domain logic (`tests/unit/<feature>-*.test.ts`).
