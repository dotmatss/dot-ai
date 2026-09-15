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

It is not a tenant chatbot, and that is the whole security argument. It has no workspace, no database row, no knowledge and no stored conversation; its request contract has no tenant identifier for an attacker to aim at, and its module graph never reaches `src/server/db`, a repository, a session or a credential. `tests/unit/public-chatbot-isolation.test.ts` walks that graph and fails if it ever does.

It answers from the published documentation. The same ranking the docs search box uses picks the relevant pages, they are passed to the gateway as grounding sources, and the citations are streamed to the browser before the first token. Because the documentation is already tested to contain no credentials and no unsupported claims, a demo grounded in it cannot promise a capability the product does not have.

### Two ways to reach a chatbot

The widget and the public API are peers, not a primary and a fallback. Both end at the same `runChatbotChat()` service and the same SSE event contract; they differ only in how the caller proves it may talk to that chatbot.

- **Widget** — the browser proves an allowed origin, gets a signed token scoped to one chatbot, and streams from `/api/public/chat`. The token is short-lived and carries no workspace secret.
- **API key** — your server proves the workspace, names the chatbot by id, and streams from `/api/v1/public/chat`. Keys are `dot_live_` plus 32 url-safe characters, stored only as a SHA-256 hash next to a six-character display prefix, and shown exactly once.

Both paths are rate limited on independent ceilings (workspace, then chatbot or key, then client) so one noisy caller cannot exhaust another's budget. See `src/server/http/rate-limit.ts`.

## Two integration directions

These are opposite and are kept visibly separate, because confusing them is how a platform ends up trusting the wrong side.

```text
Customer's application ──▶ our API          /api/v1/public/chat        they authenticate to us
our Agent ──▶ MCP client ──▶ customer's MCP server                     we authenticate to them
```

The inbound direction is authenticated by a workspace API key and bounded by rate limits. The outbound direction is the MCP feature: Streamable HTTP over HTTPS only, credentials sealed with a workspace-bound key, every request through the shared egress guard, and every tool approved by a person and pinned to the definition they approved. MCP tool calls **do** execute, and they are the only tool path that does: every call is re-checked at the point of use, recorded in `mcp_tool_calls` (refusals included), and anything classified destructive waits in an approvals queue for a person. The six built-in agent tools remain simulated. See `docs/mcp-evaluation.md`.

## Two administrative planes

The application is operated from two boundaries, and they are not two points on one scale.

```text
Platform plane                        Customer plane
requirePlatformAccess()               requireWorkspaceAccess(slug, role)
platform_admins                       organization_members.role
/admin, /api/admin                    /w/[slug], /api/v1/w/[slug]
operates the SaaS                     operates one tenant
```

There is no role value, flag or combination of memberships that promotes a customer into the platform plane: the platform guard never reads `organization_members`. Grants are made out of band by `scripts/grant-platform-admin.mjs`; no route, action or service writes to `platform_admins`. The platform plane owns tenant lifecycle, platform configuration and the platform audit trail; an organization still owns its own members, workspaces and content. See `docs/platform-control-plane.md`.

## Domain model

```text
platform_admins (user_id)          the operator boundary; no workspace_id, no RLS
platform_audit_log                 privileged actions; deliberately outlives its subject

users ─┬─ sessions
       ├─ user_identities (external providers)
       └─ organization_members (role) ── organizations ─┬─ organization_invitations (pending, token hash)
                                                        └─ workspaces
                                                            ├── chatbots ── chatbot_collections
                                                            │      └── agent_id → agents (optional; the agent it deploys)
                                                            ├── agents ── agent_collections
                                                            ├── workflows ── workflow_runs
                                                            ├── knowledge_collections
                                                            ├── knowledge_sources (collection_id, NULL = Unorganized)
                                                            │      └── knowledge_chunks
                                                            ├── conversations ── messages
                                                            │      └── conversation_insights (derived) ── conversation_topics
                                                            ├── conversation_analysis_runs (provenance of the above)
                                                            ├── contacts ── contact_notes / contact_activities
                                                            ├── integrations (non-secret config + secret_ref)   [outbound]
                                                            ├── workspace_credentials ── workspace_credential_secrets  [outbound]
                                                            ├── api_keys                                        [inbound]
                                                            ├── usage_events
                                                            └── activity_log
```

Every workspace-scoped table has `workspace_id`, explicit filters in SQL and an RLS policy (ADR 0002). The two platform tables above deliberately have none of the three: they are global, like `users` and `organizations`, and are guarded by `requirePlatformAccess` instead. `organizations.status` and `users.disabled_at` (migration 0023) are the platform plane's handles on tenant and account lifecycle.

The same tables are described in TypeScript under `src/server/db/schema/` for Drizzle. That description is generated from nothing and owns nothing: migrations remain the source of truth, and a test compares the two against the live database so they cannot drift. Repositories are being moved onto the query builder one feature at a time; `chatbot-repository.ts` is the reference, and the other nine still use `query`/`queryOne` unchanged. See `docs/orm-evaluation.md`.

## Storage

There is no object store. The only place the app takes bytes from a user is the knowledge file upload, and those bytes never come to rest as a file: `createUploadedKnowledgeSource` decodes them to text, writes the text to `knowledge_sources.content`, and discards the original. What survives of a file is its description — `fileName`, `contentType`, `sizeBytes` in `metadata` — not its contents.

That narrowing is deliberate, and its consequences are worth stating plainly: an uploaded document cannot be downloaded again, cannot be re-chunked from the original if chunking changes, and no format whose meaning lives in the bytes can be supported this way at all. PDF, Word, spreadsheets and presentations are therefore rejected by name in `UNSUPPORTED_EXTENSIONS` with an instruction — "export the sheet as CSV" — rather than accepted and ingested as mojibake.

The upload boundary is one route and one validator:

| Check | Where | Why there |
| --- | --- | --- |
| Extension + reported content type | `src/features/knowledge/uploads.ts` | Shared with the upload dialog, so a bad file is refused before the bytes are sent. Either signal alone is trivial to spoof; together they catch the honest mistakes. |
| 5 MB (`UPLOAD_MAX_BYTES`) | route, then service | Taken from the declared part size *before* the body is pulled into memory, then checked again server-side where the real length is known. |
| Strict UTF-8 decode | `knowledge-service.ts` | `new TextDecoder("utf-8", { fatal: true })`. An invalid byte sequence raises instead of producing replacement characters, which is the only reliable way to tell text from binary — so this, not the extension, is the decisive check. |

Only the service-side checks are trusted. The dialog runs the same validator purely to give a faster and more specific answer.

Everything else that looks like a file is a reference. `users.avatar_url` is a URL from the identity provider, not an image the app holds. A URL source keeps `uri` and the text fetched from it, never a copy of the page. The one real duplication is derived rather than uploaded: `knowledge_chunks` stores a second copy of the same text beside its `embedding`, and that — not the uploads — is where knowledge storage actually grows.

Stored content is workspace data like any other: `workspace_id`, explicit filters in SQL, an RLS policy (ADR 0002). Storage has no isolation mechanism of its own because none of it sits outside PostgreSQL. Settings → Storage reports what a workspace is holding per category, measured with `pg_column_size()` over the rows it owns; that is the uncompressed size of the content, not the size of the database on disk, and the page says so rather than implying a billing figure. The ceiling it would be compared against is the `storageBytes` entitlement, which every plan currently leaves `undecided`, so no bar is drawn until someone decides one. In the browser the app writes exactly one key, `dot-theme` in local storage; `docs/legal-and-privacy.md` holds the inventory and a test that fails if an unlisted `dot_*` key appears in the code.

### When object storage arrives

Cloudflare R2 is the intended home for knowledge files (`docs/environment.md`, `docs/deployment.md`). Adopting it is not a drop-in:

- `knowledge_sources` gains an object key, and `content` becomes a cached extraction rather than the only copy.
- Isolation stops being RLS alone. A bucket has no row-level security, so per-workspace key prefixes and scoped credentials have to carry that weight, and the `workspace_id`-on-every-table rule needs an equivalent a test can assert.
- Binary formats become possible, at which point the UTF-8 decode is no longer the test for "is this a document" and per-format extraction is needed.
- Deletion grows a second half. Removing a row removes the content today; with a bucket, both a source delete and a workspace purge have to reach the object store, and failing at that quietly becomes a retention problem.

## Agents

A workspace holds **many independent agents** — a support agent, a sales agent, a research agent — and has since the initial schema. `agents` is keyed on a uuid with no unique constraint on `name`, so nothing about the model assumes one agent per workspace.

An agent's identity is `agents.id`. Every route, foreign key and query addresses it by that id, and the name is display text, so renaming *Customer Support Agent* to *Support Assistant* changes nothing that points at it — including its conversations. `tests/unit/agents-persistence.integration.test.ts` asserts this against a real database rather than leaving it as an intention.

### Owned versus referenced

The split is what lets agents multiply without duplicating the workspace's resources:

| Owned by the agent (`agents` row) | Referenced by the agent |
| --- | --- |
| `name`, `description`, `status` | Knowledge collections, via `agent_collections` |
| `instructions` | MCP tools, by server slug + tool name inside the `tools` column |
| `model_config` (model, temperature, max tokens) | Conversations, via `conversations.agent_id` |
| `tools` jsonb — built-in settings **and** MCP attachments in one array | |
| `memory_config`, `output_schema`, `requires_approval` | |

Referenced resources are shared, never copied. Two agents attached to one collection produce two rows in `agent_collections` and one collection; detaching one leaves the other's access untouched. No document, chunk or embedding is duplicated per agent — retrieval is scoped at query time by the agent's `collectionIds`.

The `tools` column holds two halves read by two normalisers (`normalizeToolSettings`, `normalizeAgentMcpTools`). It is replaced outright on write, so both halves are always composed together — see `composeToolsColumn`. Built-in tool calls are recorded and explained but never executed; MCP calls are the only ones that run.

### Lifecycle

`draft → active → paused → archived`, plus deletion.

- **Activation requires instructions.** An agent with nothing to act on cannot be set `active`, whether the instructions are already saved or arrive in the same patch.
- **Archived** agents drop out of the default list but stay addressable by id, which is what keeps historical conversations explainable. Archiving is the reversible way to retire an agent.
- **Deletion** is permanent. `agent_collections` and the agent row go; `conversations.agent_id` is `ON DELETE SET NULL`, so transcripts survive but lose attribution, and `mcp_tool_calls.agent_id` behaves the same way. Prefer archiving where the history still needs to name the agent that produced it.

### Permissions

Enforced server-side by `workspaceRoute`, which authenticates the session, resolves membership of the workspace named in the URL and checks a minimum role before the handler runs. The UI hides what a role cannot do, but that is presentation, not a control.

| Operation | Minimum role |
| --- | --- |
| List agents, read one, read its knowledge options and analytics | `viewer` |
| Create an agent; edit instructions, model, tools, knowledge, memory, security | `member` |
| Run a turn in the playground (spends tokens, can reach a real MCP tool) | `member` |
| Delete an agent | `admin` |

`tests/unit/agents-authorization.test.ts` pins this table to the route sources, so a new agent route cannot ship without a decision being recorded about who may call it.

### Tenant boundaries

Four layers, all of which an agent operation crosses: session → workspace membership → the agent's own `workspace_id` → the resource being attached.

Cross-workspace reads, writes and deletes of an agent return **404, not 403** — confirming an agent exists to a non-member is itself a disclosure. Attaching a foreign collection is rejected by an ownership count before any write; attaching a foreign MCP server is rejected by `assertAttachableServers`, which resolves slugs only within the caller's workspace, so guessing another tenant's slug fails. Row Level Security backs all of it as a second layer (ADR 0002).

### Chatbot → Agent

A chatbot is a **channel**; an agent is the **worker** it can deploy. `chatbots.agent_id` is the optional edge between them (migration 0020).

```text
Workspace
├── Agents            Support Agent ◀──┐
└── Chatbots          Website Bot  ────┘   agent_id → the agent that answers
                      Docs Bot     ────    agent_id NULL → its own configuration
```

The link is **optional and additive**. `agent_id IS NULL` is what every pre-existing chatbot has, and such a chatbot behaves exactly as it did before: nothing was backfilled, and `chatbots.instructions`, `chatbots.model_config` and `chatbot_collections` are all still there.

**What an agent-backed chatbot inherits** — instructions, model configuration, knowledge collections. That is the entire list, and the omissions are the design:

| Agent capability | In a chatbot channel |
| --- | --- |
| Instructions, model config | **Inherited** |
| Knowledge collections | **Inherited** — the agent's, never merged with the chatbot's |
| Built-in tools, MCP tools | **Do not run** |
| Memory window, structured output, approvals | **Do not run** |

Tools stay out because a chatbot channel is reachable by anonymous visitors while `runAgentChat` genuinely executes MCP tools against the workspace's sealed credentials. Linking an agent changes what the model is *told*, never what it is *able to do*, so the public attack surface is identical before and after. The prompt says so explicitly, otherwise an agent whose instructions assume tools would offer actions the channel cannot perform.

Knowledge resolves to exactly one source rather than a union, because merging the two lists would let linking an agent silently widen what a public widget can retrieve. The chatbot's own attachments are kept untouched, so unlinking is a complete return to the previous behaviour.

`resolveChatbotRuntime` in `chatbot-runtime.ts` is the only place that decides this, and all three channels — widget, public API, playground — reach it through `runChatbotChat`, so they cannot drift apart. It resolves the agent through the *chatbot's* workspace and **fails closed**: a link that cannot be honoured returns 503 rather than quietly serving the chatbot's old instructions.

**Tenant boundary.** The foreign key is composite — `(agent_id, workspace_id) → agents (id, workspace_id)` — so a chatbot pointing at another workspace's agent is not representable, not merely rejected by application code. Anonymous callers identify a *chatbot* (embed key or id); the agent is resolved from the stored row, never from the request.

**Lifecycle.** `ON DELETE RESTRICT`, plus a service check, so archiving or deleting an agent a chatbot deploys is refused with a 409 naming the chatbots. Renaming an agent changes nothing (the link is by id). A conversation records both `chatbot_id` and `agent_id`, so reassigning a chatbot leaves earlier conversations attributed to the agent that actually handled them. Usage metering is unchanged and still attributed to the chatbot; per-agent attribution is available through `conversations.agent_id`.

**Permissions.** Linking is part of editing a chatbot (`member`), which grants nothing new: any member can already create and edit agents in the workspace, so the meaningful control is that the agent must belong to the same workspace.

### Composing agents

Agents are workers; compositions of agents are not a kind of agent. Two mechanisms exist, and they are different because the decisions they encode are made at different times:

| | Who decides the shape | Mechanism |
| --- | --- | --- |
| **Static composition** — sequential, handoff, conditional routing | the author, when building | a Workflow with `agent.run` steps |
| **Dynamic delegation** — the model picks who handles what, while running | the model, at run time, within a grant | `agents.can_delegate` + `agent_delegations` |

The same agent can be used on its own, placed in several workflows, granted to several delegating agents, and itself delegate — without being duplicated. Neither mechanism is "the" multi-agent architecture: the workflow graph is the composition layer, delegation is the dynamic-dispatch primitive, and an agent that delegates can sit as one step inside a workflow.

### Agents in workflows — `agent.run`

The workflow engine was already a general DAG — nodes, conditional edges, topological ordering, cycle rejection, a preview canvas — with a registry documented as its extension seam. `agent.run` is one registry entry and one injected dependency:

```text
Workflow executor ──runAgent(agentId, task)──▶ agent engine ──▶ AgentExecutionResult ──▶ {{vars.key}} ──▶ next step
```

`runAgent` is injected into `executeDefinition` exactly as `gateway` and `fetchImpl` are, so the engine stays pure and a definition containing an agent step **cannot execute anywhere the server did not deliberately provide a runner** — it fails before its first step, so no earlier action step runs for nothing. The server's runner (`workflows/server/executor.ts`) is bound to the run's workspace and run id: the agent id in a step is a request, re-resolved through the run's own workspace, and an id from anywhere else is "not available".

The step receives only the rendered task and returns only the agent's answer, status, usage and approval flag — into `{{vars.<outputKey>}}` for the next step. Tokens are metered once, by the agent engine, against the agent that spent them; the run step keeps a copy for the timeline but does not add them to the run's own usage. Every `agent.run` opens an `agent_executions` root linked to the run (`workflow_run_id`, migration 0022), so a run's whole agent tree is two indexed lookups away.

**MCP is off for every agent a workflow runs, and for everything that agent delegates to.** The tool policy is set on the root execution and inherited unchanged down the tree; under it no MCP bundle is even loaded. A workflow step is the one place an agent runs with no person in the loop, and this is the line that keeps workflows from becoming an indirect route to a customer's MCP servers. Enabling it is a separate security decision, not a flag. Today the only way to start a run is the authenticated, rate-limited `member` route — there is no public webhook ingress and `trigger.webhook` is presentation-only — so the restriction is defence in depth for the day one is added.

**Bounded twice over.** A definition may hold at most `MAX_AGENT_STEPS` (5) agent steps — the builder refuses more — and a run shares one `WORKFLOW_AGENT_WALL_CLOCK_MS` (120 s) across all of them, spent in order; each agent still brings its own per-turn budget beneath that. Without the ceiling above them, a chain of agent steps would multiply one agent's allowance by the number of steps inside a single request handler. A step whose stream dies or is cancelled part-way is reported as **failed**, not as a shorter answer: text that stops mid-sentence is not something the next step should be handed.

Existing workflow behaviour is untouched: the executor still follows one edge and still rejects cycles, so parallel fan-out and reviewer loops are storable-but-not-runnable exactly as before, each waiting on its own gate.

### Dynamic delegation

An agent with `can_delegate` may hand a task to explicitly granted agents in its own workspace while it runs. `agents.can_delegate` is a boolean on the existing table — there is no supervisor entity, no type enum and no subclass, so every route, policy and test that works on agents works unchanged. The UI presents it as a switch on the agent's **Delegation** tab, not as a type chosen at creation.

```text
Operations Supervisor
        │
   ┌────┼────┐            delegation grants, explicitly ticked
   ↓    ↓    ↓
Research Sales Support    each runs on ITS OWN configuration
```

**One engine, two adapters.** `agent-engine.ts` is the whole agent turn — retrieval, the completion loop, built-in tool resolution, MCP execution, delegation, persistence and metering. `runAgentChat` streams it as SSE; `executeAgentTask` collects it into a value for a supervisor. There is deliberately no second executor: the rules about what a tool may do and when a call stops for a person are security decisions, and two implementations of a security decision eventually disagree.

**The model decides less than it appears to.** It may choose whether to delegate, which of the agents it was *shown* to use, and what to ask. It is shown names, never database ids. Whether that agent may actually be called — granted, enabled, not archived, not already on the path, within depth, within budget, before the deadline — is re-decided server-side from stored state on every call. An `agent_id` from a model is a request, never an authorization.

**What a supervisor does not get.** Delegating runs the child, on the child's instructions, model, collections, tools, MCP grants and approval policy. The supervisor receives only:

| Returned to the supervisor | Never returned |
| --- | --- |
| the child's final answer | its prompt, reasoning or tool calls |
| status, usage, execution id | its retrieved passages or MCP arguments/results |
| whether something awaits approval | any credential, connection or configuration |

So a supervisor whose child can reach Salesforce does not thereby reach Salesforce; it can only ask that agent a question. The child's MCP approval policy stays authoritative — a gated call parks in the approvals queue exactly as it would have, and the child answers with what it could do without it. A supervisor cannot approve, bypass, or reach the credential.

**Limits, enforced not requested.** Depth 2, three child runs per request, 60 seconds and a shared token budget by default (`delegation-limits.ts`), clamped to hard ceilings on read so a hand-edited `delegation_config` cannot raise them. The deadline and the budget are one object shared by the whole tree, so three sequential children divide one allowance rather than each getting a fresh one. None of this is stated to the model.

**Recursion** is refused in four independent places: a database CHECK for self-delegation, composite foreign keys for workspace crossing, an `agent_path` membership test for cycles, and the depth/count checks before a child starts. The grant graph may legally contain a loop; what cannot happen is one being walked.

**Execution records.** `agent_executions` holds one row per turn, with `root_execution_id`, `parent_execution_id`, `agent_path` and `depth`. It is what the limits are enforced against and what makes a multi-agent request reconstructable. Child executions create **no conversations** — a delegated task is not a thread the user opened — so the single user-facing conversation stays the supervisor's, and `conversations.agent_id` still names the agent the user talked to. Usage is metered per turn against the agent that spent it, so a child's tokens are attributed to the child.

**Two limitations, both deliberate:**

- **Delegating agents cannot be deployed to a chatbot.** Chatbot channels are anonymous and tool-free; delegation is a tool that executes other agents. Both services refuse the combination and `resolveChatbotRuntime` fails closed if one ever appears, rather than quietly serving the agent with its delegation removed.
- **Everything runs inline, inside one request** — a workflow run, each `agent.run` step, and each delegation. Nothing queues and nothing resumes, which is exactly why the limits are small and why `MAX_RUN_STEPS` still bounds a workflow that runs agents. Long-running orchestration needs the background execution `workflows/server/executor.ts` already names as its production path, and this release does not have it.

Delegation is not agent-to-agent access: an agent cannot call another agent except through a grant a person ticked, and it never receives anything of the other's but an answer.

### Not yet connected

Documented here because their absence is a design position, not an oversight:

- **Agents do not start workflows.** The `run_workflow` built-in tool is simulated like every built-in; a workflow can run an agent, not the reverse.
- **Parallel fan-out, N-way routing and reviewer loops** are expressible in a stored definition and deliberately not runnable: each changes the executor's or validator's contract and is gated separately.
- **Agents do not reference integration connections.** There is no `agent_integrations` table. The built-in tools that would need one (`send_email`, `http_request`) are simulated, so no agent has ever been handed a credential. Secrets live in `integration_secrets`, `mcp_credentials` and `workspace_credential_secrets`, and none of the three is ever loaded into agent configuration or sent to a client.
- **Workflows can be handed one, and only through a step that opts in.** A `tool.http_request` step may name a credential from `workspace_credentials`; the executor resolves it against the run's own workspace and merges the resulting header into the request. This is the one path on which a stored credential leaves the server, and it still requires the step's `allowOutbound` switch and its host allowlist. Agent steps in the same workflow are unaffected — an agent never sees the header. See ADR 0006.

Agent-to-agent delegation is deliberately absent: there is no supervisor, no routing and no shared execution state.

## Workflow visualization

The workflow builder has one definition and two views of it. `WorkflowBuilder` owns the draft (`useBuilderState`, plain React state); the Build tab edits it and the Preview tab draws it. Both read the same `WorkflowDefinition`, so there is nothing to keep in sync.

```text
                     WorkflowDefinition  (workflows.definition jsonb)
                              │
        ┌─────────────────────┼─────────────────────┐
        ↓                     ↓                     ↓
  validateDefinition     buildPreviewGraph      runWorkflow
   (domain/definition)   (domain/preview)      (domain/execution)
                              ↓
                       PreviewGraph  ──→  WorkflowPreviewCanvas / …Node / …Summary
```

`buildPreviewGraph` is the whole seam. It is pure and DOM-free — layered ranking, orthogonal edge paths, an accessible walkthrough — so it is unit tested like `chart-geometry.ts`, and the renderer receives coordinates and strings rather than Zod schemas or node registry entries. Everything a node *means* comes from `NODE_TYPES`, so a new node type (an MCP tool, an agent, a knowledge lookup) is previewable the moment it is registered; the preview has no node list of its own. A definition the validator rejects still draws: duplicate ids, edges pointing at deleted steps and cycles are dropped or marked rather than thrown.

The preview is read-only by construction, not by a flag — it is handed a definition and no mutator, so an edit is unrepresentable. Navigation (pan, zoom, fit) is local `useState` inside the canvas.

Run state is modelled but never produced here: `buildPreviewGraph(definition, { states })` accepts a status per node and every node defaults to `idle`, which renders no status at all. That is what keeps a static diagram from implying a run happened, and it is the seam a future execution view uses — the same graph plus a run's steps — instead of a second renderer. Steps the engine only records (`describeNodeEffect`) are labelled "Simulated" for the same reason.

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
- Integration: `tests/unit/*.integration.test.ts` run against real PostgreSQL and skip themselves when `DATABASE_URL` is unset, so the default suite stays hermetic. They cover the claims only a database can settle — RLS, schema drift, persistence and tenant boundaries (`agents-persistence` proves multiple agents per workspace and their isolation). Run one with `node scripts/verify.mjs --tests agents-persistence`.
- Structural: a few suites assert how code is *declared* rather than what it returns, because the property has no runtime symptom until it is already a breach — `mcp-isolation` (no stdio transport, every request through the egress guard) and `agents-authorization` (every agent route behind the workspace guard, at the intended minimum role).
- End-to-end: sign up → create chatbot → configure → playground → deploy (`tests/e2e`, Playwright, runs against the dev server and a real PostgreSQL).
