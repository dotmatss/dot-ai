# Architecture

## Goals

Build a platform, not a collection of screens: new AI capabilities, workflow node types, knowledge sources, integrations and CRM features must slot into existing seams without rewrites. Tenant isolation, client/server boundaries and provider-agnostic AI are structural, not conventions.

## Layers

```text
Browser ── Client Components (interaction) ── TanStack Query (server state) ── apiFetch ──┐
                                                                                         ▼
Next.js App Router ── Server Components (pages/layouts) ── Data Access Layer ── Services ── Repositories ── PostgreSQL
                      Route Handlers (/api/v1, /api/public) ─┘                    │
                      Server Actions (auth, onboarding)      ─┘                    └── AI gateway ── Cloudflare AI Gateway / mock
```

| Layer | Location | Responsibility |
| --- | --- | --- |
| Design tokens | `src/app/globals.css` | Typography scale, ink palette, semantic surfaces/borders/foreground, status tones, radii, shadows, motion. A `.dark` block redefines the semantic tokens only; see `docs/theming.md` |
| UI primitives | `src/components/ui`, `feedback`, `forms`, `charts`, `chat`, `layout` | Reusable, accessible building blocks with explicit variant maps; no business logic |
| Features | `src/features/<domain>` | Types, schemas, API client, queries/mutations, server repository + service, components (see `feature-conventions.md`) |
| Routing | `src/app` | Thin pages/layouts: authorize, load, hydrate, compose. Route handlers expose the JSON API |
| Server boundary | `src/server` | `db` (pool, transactions, RLS scoping, Drizzle schema + query builder), `auth` (sessions, passwords, DAL), `http` (responses, request parsing, CSRF, rate limits, `workspaceRoute`), `ai` (gateway + SSE), `activity`, `usage` |
| Client state | `src/stores`, `src/hooks` | Zustand for UI preferences and toasts (per-request store for SSR safety); URL for list filters; an external store read through `useSyncExternalStore` for the theme |
| Config | `src/config` | Validated server env, navigation, site metadata |

## Request flows

**Page load** — `layout.tsx` under `/w/[workspaceSlug]` calls `requireWorkspaceAccess(slug)`: resolves the session cookie → user → membership/role, returning 404 for unknown workspaces and 403 for insufficient roles. Pages load data through services, seed a request-scoped `QueryClient` with `setQueryData`, and wrap client trees in `HydrateClient`. Client components read the same query keys, so the first render is instant and TanStack Query owns freshness thereafter.

**Mutation** — a client mutation calls `apiFetch` → `/api/v1/w/[slug]/...`. `workspaceRoute` enforces same-origin (Origin + `X-Requested-With`), session, membership and minimum role, validates input with Zod, and maps any error to the `{ error: { code, message, details } }` envelope. Services run in `withWorkspace()` transactions and record activity. Mutations invalidate list keys and update detail caches; optimistic updates are used for cheap fields (status, name).

**AI turn** — `runChatbotChat()` persists the user message, retrieves knowledge through `retrieveKnowledge()`, streams from `getAiGateway()`, forwards normalized events as SSE, then persists the assistant message, citations and token usage. The client `useChatStream` hook renders partial text, sources, usage, errors, cancellation and retry.

**Embedding** — see ADR 0004: loader script → iframe → server-side origin check → signed embed token → public chat endpoint with rate limits.

## Public surface

Three things are reachable without a session, and each has its own trust model.

| Surface | Routes | Trust model |
| --- | --- | --- |
| Marketing site | `src/app/(marketing)` — `/` | Fully static. The header deliberately does not read the session, so the page stays prerenderable and cacheable |
| Documentation | `src/app/(marketing)/docs` — `/docs`, `/docs/[...slug]` | Authored as data in `src/features/docs/content`, prerendered by `generateStaticParams`. No credential ever appears in an example; `tests/unit/docs-content.test.ts` fails the build if one does |
| Legal | `src/app/(marketing)/{terms,privacy,cookies}` | Authored as data in `src/features/legal/content`. The cookie policy exists only while the application stores something in a browser. Tests refuse invented entities, addresses, jurisdictions, vendors and compliance claims. See `docs/legal-and-privacy.md` |
| Public API | `/api/v1/public/chat` | Authenticated by a workspace API key (`Authorization: Bearer dot_live_…`), never by a cookie |
| Product demo | `/api/public/demo/chat` | Anonymous. Safe because it is tenant-less: no workspace, no chatbot row, no persistence. See below |
| Widget API | `/api/public/chat` | Authenticated by a short-lived signed embed token minted only for an allowed origin (ADR 0004) |

`src/proxy.ts` treats `/sign-in`, `/sign-up`, `/embed` and `/docs` as public, and never redirects `/api/*`: an API caller gets a JSON 401, not an HTML sign-in page.

### The landing-page demo

The marketing site carries a chat launcher that loads its own code on first click, so a visitor who never opens it downloads a button and nothing else.

It is not a tenant chatbot, and that is the whole security argument. It has no workspace, no database row, no knowledge base and no stored conversation; its request contract has no tenant identifier for an attacker to aim at, and its module graph never reaches `src/server/db`, a repository, a session or a credential. `tests/unit/public-chatbot-isolation.test.ts` walks that graph and fails if it ever does.

It answers from the published documentation. The same ranking the docs search box uses picks the relevant pages, they are passed to the gateway as grounding sources, and the citations are streamed to the browser before the first token. Because the documentation is already tested to contain no credentials and no unsupported claims, a demo grounded in it cannot promise a capability the product does not have.

### Two ways to reach a chatbot

The widget and the public API are peers, not a primary and a fallback. Both end at the same `runChatbotChat()` service and the same SSE event contract; they differ only in how the caller proves it may talk to that chatbot.

- **Widget** — the browser proves an allowed origin, gets a signed token scoped to one chatbot, and streams from `/api/public/chat`. The token is short-lived and carries no workspace secret.
- **API key** — your server proves the workspace, names the chatbot by id, and streams from `/api/v1/public/chat`. Keys are `dot_live_` plus 32 url-safe characters, stored only as a SHA-256 hash next to a six-character display prefix, and shown exactly once.

Both paths are rate limited on independent ceilings (workspace, then chatbot or key, then client) so one noisy caller cannot exhaust another's budget. See `src/server/http/rate-limit.ts`.

## Domain model

```text
users ─┬─ sessions
       ├─ user_identities (external providers)
       └─ organization_members (role) ── organizations ── workspaces
                                                            ├── chatbots ── chatbot_knowledge_bases
                                                            ├── agents ── agent_knowledge_bases
                                                            ├── workflows ── workflow_runs
                                                            ├── knowledge_bases ── knowledge_sources (── knowledge_chunks)
                                                            ├── conversations ── messages
                                                            ├── contacts ── contact_notes / contact_activities
                                                            ├── integrations (non-secret config + secret_ref) / api_keys
                                                            ├── usage_events
                                                            └── activity_log
```

Every workspace-scoped table has `workspace_id`, explicit filters in SQL and an RLS policy (ADR 0002).

The same tables are described in TypeScript under `src/server/db/schema/` for Drizzle. That description is generated from nothing and owns nothing: migrations remain the source of truth, and a test compares the two against the live database so they cannot drift. Repositories are being moved onto the query builder one feature at a time; `chatbot-repository.ts` is the reference, and the other nine still use `query`/`queryOne` unchanged. See `docs/orm-evaluation.md`.

## State management rules

| Kind | Tool |
| --- | --- |
| Server data | TanStack Query (keys per feature; server prefetch + hydration) |
| Local component state | `useState` / `useReducer` |
| Form state | React Hook Form + Zod resolver |
| Global client-only state | Zustand (`ui-preferences-store`, `toast-store`) |
| List filters, tabs, pagination | URL search params (`useSearchParamState`) |

## Error and empty states

`AppErrorState` (kinds: error, not-found, forbidden, unauthorized, unavailable) and `AppEmptyState` are used everywhere; route-level `error.tsx`, `not-found.tsx`, `unauthorized.tsx` and `forbidden.tsx` cover the App Router boundaries (`experimental.authInterrupts` enables `unauthorized()`/`forbidden()`). Database outages surface as a 503 `unavailable` API error and a retryable page state rather than a crash.

## Observability hooks

Error boundaries log to the console today; wire an error-tracking provider in `src/app/error.tsx`, `global-error.tsx` and `src/server/http/responses.ts` (`toErrorResponse`) once selected. Usage events (`usage_events`) and the activity log already provide product-analytics raw material.

## Testing strategy

- Unit: schemas, filter parsing, slug/domain/token helpers, SSE parsing, roles (`tests/unit`, Vitest).
- Component: primitives and form wiring (`src/**/*.test.tsx`, Testing Library).
- End-to-end: sign up → create chatbot → configure → playground → deploy (`tests/e2e`, Playwright, runs against the dev server and a real PostgreSQL).
