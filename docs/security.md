# Security posture

What is implemented today, why it is arranged this way, and what is deliberately still open. Claims here correspond to code in the repository; anything aspirational is under [Known gaps](#known-gaps).

## Trust boundaries

```text
Browser (untrusted)  ──►  proxy.ts (optimistic gate, never authorization)
                          │
                          ├─► Server Components ─┐
                          ├─► Server Actions ────┼─► Data Access Layer ─► services ─► repositories ─► PostgreSQL
                          └─► Route handlers ────┘        (identity + role resolved here, per request)
Customer website (untrusted) ──► /embed/[key] iframe ──► /api/public/chat (signed widget token)
API client (untrusted)       ──► /api/v1/public/* (workspace API key)
```

Everything that crosses one of those arrows is untrusted input, including request headers, the `Referer`, and any id in a request body.

## Identity and sessions

- Sessions are owned by the application: a 256-bit random token in an `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookie. The database stores only its SHA-256 hash, so a database read cannot mint a session.
- Expiry is server-side. A 30-day sliding window refreshes on activity, capped by a 90-day absolute deadline measured from sign-in, so a session cannot slide forever. The cookie deliberately outlives the window: the row is the single source of truth, and a cookie that died first would sign out an active user whose session had been extended.
- Revocation is a row delete. `destroySession` and `destroyAllUserSessions` take effect on the next request. Sign-out surfaces a failure rather than reporting success it cannot confirm.
- Passwords use Node's scrypt with a per-password salt, and the work factor is stored alongside the hash so it can be raised without invalidating credentials. Verification runs against a dummy hash when the account does not exist, so response time does not reveal whether an email is registered. Inputs are NFKC-normalized so equivalent Unicode spellings match.
- Invitations follow the session pattern: a 256-bit token in the link, only its SHA-256 in `organization_invitations`, so a database read cannot join an organization. An invitation is bound to the address it was issued to and re-checked against the signed-in account at acceptance, which is what makes it an invitation rather than a join code; it is single-use (the row is locked and marked accepted in the same transaction), expires after 7 days, and can be revoked. Nothing is emailed - the inviter copies the link - so the link is shown exactly once, in the response that creates it.
- `/invite/:token` is public by necessity, since the invitee may have no account yet. It discloses only the organization name, the invited address and the offered role, and renders the same "not valid" card for a revoked, used, mistyped or forged token.
- `proxy.ts` only redirects requests that carry no session cookie, and never touches `/api`. It never redirects *away* from the auth pages: a cookie can outlive its row, and bouncing on cookie presence alone would trap that browser in a loop it cannot escape, because the cookie is HttpOnly. The auth pages redirect only after the Data Access Layer confirms a real session.

## Authorization and tenant isolation

Two independent layers, described fully in [ADR 0002](adr/0002-tenant-isolation.md):

1. **Explicit scoping.** Every tenant table carries `workspace_id`; repository SQL always filters on it, using the workspace id resolved from the caller's verified membership — never one supplied by the client. Pages call `requireWorkspaceAccess`, route handlers are wrapped in `workspaceRoute(handler, { minimumRole })`.
2. **Row Level Security.** Policies restrict rows to the workspace named in the transaction-local `app.workspace_id`, set by `withWorkspace()`. Policies are `FORCE`d (migration 0013), because RLS does not apply to a table's owner and the application usually connects as that role. The predicate is cast-safe (migration 0014): PostgreSQL does not guarantee OR short-circuiting, and the earlier version could evaluate `''::uuid` and fail an unrelated query on a pooled connection.

Roles are organization-level: `owner > admin > member > viewer`. Reads need `viewer`, writes `member`, destructive or administrative actions `admin` or `owner`. UI gating is cosmetic; the server re-checks every time. Navigation and tabs carry the same floors as the pages behind them (`visibleForRole` in `src/config/navigation.ts`), so a link is never offered to someone it would refuse — but hiding it is presentation, not a boundary.

`src/features/settings/permissions.ts` states each capability's floor in one table, which the Roles & permissions page renders and `tests/unit/settings-permissions.test.ts` checks against the route handlers that enforce it. A matrix nothing verifies is documentation that rots into a lie.

Two surfaces are admin-only reads rather than admin-only writes: the **audit log** (`/settings/audit`, `GET /api/v1/w/:slug/audit`), because a record of who did what across every feature is an oversight power; and the **invitation pipeline**, which `getMembersOverview` omits for anyone who cannot manage members — the member roster stays readable by every role, while the addresses of people who have not joined do not.

Unknown or inaccessible workspaces return **404**, not 403, so their existence is not disclosed.

**The platform plane is a separate authorization boundary**, resolved from `platform_admins` and never from an organization role — holding `owner` everywhere grants nothing there. Pages under `/admin` use `requirePlatformAccess()` and every `/api/admin` route is wrapped in `platformRoute`, which has no `minimumRole` option because there is only one privilege level inside it. An authenticated caller without a grant gets **404**, not 403, for the same non-disclosure reason as above, and the refusal is recorded in `platform_audit_log` as `platform.access.denied`. Platform reads cross tenants by running outside `withWorkspace()` — the RLS predicate is already permissive when unscoped (migration 0014), so nothing is disabled or re-granted; `tests/unit/platform-isolation.test.ts` is what keeps those modules out of every customer surface and keeps credential columns out of the operator's reads. Suspending an organization or disabling a user closes access without deleting data, and `src/server/auth/lifecycle.ts` fails closed on the anonymous and key-authenticated paths that have no session to check. See `docs/platform-control-plane.md`.

`tests/unit/rls.integration.test.ts` proves the second layer by connecting as a non-superuser and asserting that a query with no `workspace_id` predicate still sees only one tenant. **Deploy with a non-superuser database role**: superusers bypass RLS entirely.

A chatbot may deploy an agent (`chatbots.agent_id`). The foreign key is composite — `(agent_id, workspace_id)` references `agents (id, workspace_id)` — so a cross-workspace link is unrepresentable rather than merely rejected in code, and the public paths never accept an agent id: an anonymous caller names a chatbot, and the server resolves the agent from the stored row. Deploying an agent does **not** give the channel the agent's tools: built-in and MCP tools stay in the agent runtime, so linking an agent cannot turn an anonymous website visitor into someone who can drive MCP tool calls. A link that cannot be resolved fails closed rather than falling back to the chatbot's own instructions.

A workflow may run an agent (`agent.run`). The runner is bound to the run's workspace, so the agent id stored in a step is re-resolved through that workspace and an id from anywhere else is "not available". **MCP is off for every agent a workflow runs and for everything it delegates to** — set once on the root execution, inherited down the tree, and no bundle is loaded under it — because a workflow step is where an agent runs with no person in the loop. Today runs start only from the authenticated, rate-limited `member` route (no public webhook ingress exists), so this is defence in depth for when one is added.

An agent with **dynamic delegation** enabled may delegate to other agents, and delegation crosses no security boundary. The child is reloaded by `(workspace_id, agent_id)` and runs on its own instructions, knowledge, tools, MCP grants and approval policy; the supervisor receives its answer, a status and usage — never its prompt, tool calls, retrieved passages, MCP arguments, connections or credentials. A supervisor therefore cannot borrow a child's access: it can only ask. The child's MCP approval requirement is untouched, so a gated call still waits for a person and the supervisor can neither approve it nor reach the credential behind it. Which agents may be called is decided server-side from `agent_delegations` on every call — the model is shown names, never ids, and an id it produced would authorize nothing. Both foreign keys on that table are composite, so a cross-workspace grant has no representable row, and a CHECK refuses self-delegation. Recursion is bounded by an `agent_path` cycle test plus depth, delegation-count, deadline and token limits that are clamped on read and never stated to the model. Delegating agents are refused in public chatbot channels in both directions, and the chatbot runtime fails closed if one appears anyway.

A workspace holds many agents, so "which agent" is a boundary of its own inside an already-authorized workspace. An agent is never a principal: it holds no credentials and is never handed one. Everything it may reach is resolved from *its own* `workspace_id` at the point of use — collections through `agent_collections`, MCP tools through grants re-checked on every call. Attaching a resource is checked for ownership before any write, and MCP servers are attached by slug rather than id precisely so that guessing another tenant's row is not a reachable move. Deleting an agent clears `conversations.agent_id` and `mcp_tool_calls.agent_id` rather than cascading, so an audit trail is never destroyed by removing the agent that produced it. `tests/unit/agents-persistence.integration.test.ts` asserts the boundary against a real database and `tests/unit/agents-authorization.test.ts` pins the per-role rule to the route sources.

## Request-level protections

- **CSRF.** Cookies are `SameSite=Lax`; mutating API routes additionally require the `Origin` to match the host and an `X-Requested-With: fetch` marker that a cross-site form cannot set. Server Actions rely on the framework's own Origin check.
- **Validation.** Every request body goes through `parseJsonBody(request, schema)` and every query string through `parseSearchParams`, both Zod. Failures become a `422` with per-field detail.
- **Output shaping.** Services return mapped domain objects, never raw rows; errors leave through one envelope (`{ error: { code, message, details } }`) with no internals. Upstream AI gateway error bodies are logged server-side and replaced with a generic message, because that stream is read by anonymous visitors.
- **Server-only code** is marked with the `server-only` package, so a client import fails the build rather than shipping database access to the browser.

## Outbound requests

Three paths let a customer choose an address our server will connect to: the
knowledge URL importer, the integration connection tester, and the MCP client.
A request that leaves from inside our network can reach things the browser
never could - cloud metadata, internal admin panels, databases - so all three
go through one module, `src/server/http/egress-guard.ts`. It is the only place
in `src/` that resolves DNS or classifies an address, and a test asserts that
count stays at one.

Per request, and again for every redirect hop:

1. Scheme, embedded credentials, port and literal-address policy. A caller may
   supply its own wording for these refusals, but the shared policy is applied
   as a floor and cannot be widened.
2. The name is resolved - both A and AAAA records - and **every** returned
   address is checked. One public and one private answer is a refusal, not a
   choice.
3. Redirects are followed manually so 1 and 2 apply to each hop; an open
   redirect is the usual route to `169.254.169.254`.
4. One wall-clock budget covers the whole exchange, and the response body is
   size-capped (except `text/event-stream`, which is bounded by the clock
   instead, since its total size is not meaningful).

### The window this leaves open

Step 2 validates a **name**. Step 3 connects by handing that same name to
`fetch`, which resolves it again. The decision and the connection therefore
rest on two separate DNS answers, and a resolver under an attacker's control
can answer the first with a public address and the second with a private one.
That is a time-of-check-to-time-of-use window, and **it is open**.

It was closed once. Phase 2a pinned each connection to the address that had
just been validated, using a per-request `undici.Agent`. That was removed when
the deployment target was set to Cloudflare Workers, which offers no way to fix
a connection to a chosen address: the platform `fetch` is the runtime's own and
takes no custom dispatcher. `dns.lookup()` is unavailable there too, which is
why the guard uses `resolve4`/`resolve6`. The trade-off was made explicitly;
see `docs/deployment.md` and phase 2a in `docs/mcp-phase2-gate.md`.

What remains is real and is not nothing: the scheme and port policy, the
refusal of private literals, the per-address check across both families, and
the per-hop re-validation of redirects. The MCP specification's own guidance
names this residual window and recommends combining DNS checks with other
mitigations, which is what those layers are. But a determined attacker who
controls DNS for a name a customer configured can still reach an internal
address, and nothing below the application layer currently stops them.

**Also not claimed.** Fixing this at the application layer is not the only
option: a forward proxy that enforces the policy, or running on a runtime where
the socket can be pinned, would both close it. Neither is in place.

## Tools that actually run

MCP tool calls execute. They are the only tool path that does — the six
built-in agent tools are still simulated — and the asymmetry is deliberate:
MCP is the only one where running something is a decision a person actually
made, because it is the only one with a per-tool grant, a content-hash pin on
the definition that was approved, a risk classification and an approval gate.

Five things happen for every call, in this order:

1. **Re-read, then decide.** The grant, the tool definition and the server's
   status are read at the point of use, not taken from the snapshot the turn
   started with. A grant revoked, or a tool redefined, between the model being
   told about a tool and the model asking for it refuses the call.
2. **Both levels must hold.** The workspace granted the tool *and* the agent
   attached it. Granting is an admin decision; attaching is agent
   configuration, and it can only narrow what is already allowed.
3. **Record before acting.** A `running` row is written before the request
   leaves, so a process that dies mid-call leaves evidence that we tried. For a
   destructive tool, "no row" and "did not run" must not look the same.
   Refusals are recorded too: a log of successes cannot answer "did anything
   try".
4. **Anything destructive waits.** `requires_approval` cannot be switched off
   for a destructive tool — the service enforces it and a `CHECK` constraint
   backs that up. The call is queued, and approving it re-checks everything
   from scratch: a click made before a grant was revoked does not run it.
5. **The result is data.** What comes back is third-party text heading for a
   model's context, so it is bounded and fenced with a per-call random nonce
   plus an explicit instruction not to obey it. A fixed delimiter could be
   closed by the tool's own output. The text is never rewritten to look safe:
   a tool's output is evidence.

**OAuth 2.1** is supported and is the preferred authentication: the server
decides the scope, the user consents, and access can be revoked at the source.
We are a public client with no secret (revision 2026-07-28 deprecates Dynamic
Client Registration in favour of a published Client ID Metadata Document), so
PKCE with S256 is required rather than optional, `resource` binds every token
to one MCP server, and `iss` is checked against the issuer discovery started
from. Every discovery, exchange and refresh goes through the egress guard
above — a chain of URLs supplied by a customer's server is exactly the SSRF
primitive that guard exists for.

**What this does not claim.** A tool a person approved can still do whatever
the remote server makes it do; the risk class is our classification of it, not
a constraint on it. Prompt injection is assumed rather than prevented: the
defence is that a call is gated on a human decision and bounded, not that a
model cannot be talked into asking.

## The embed boundary

The widget is the only path from an anonymous third-party page to a tenant's chatbot. See [ADR 0004](adr/0004-embed-security.md).

- The loader script holds no secret; the embed key is a public identifier.
- The iframe document is served only when the chatbot is `active` and the parent origin matches the chatbot's allowed-domain list (exact host or `*.example.com`; a subdomain does not inherit an exact entry). Workspace members with an editing role get a preview token from the app origin so they can test an inactive chatbot — viewers do not, because a preview token can spend model budget.
- That decision is carried in a short-lived HMAC-signed token bound to `{ embedKey, origin }`, which `/api/public/chat` re-verifies along with status and domain. The token payload is signed, not encrypted, and deliberately contains nothing sensitive.
- Application routes send `X-Frame-Options: DENY` and `frame-ancestors 'none'`; only `/embed/*` may be framed.

**Known limitation, stated plainly:** the parent origin is derived from the `Referer` header, which a non-browser client can set freely. A server-side caller that knows a published embed key can therefore mint a token and use the chatbot outside its allowed domains. Browsers cannot do this cross-origin, and the cost of such abuse is bounded by the ceilings below, but allowed-domain enforcement should be understood as a browser-facing control, not an API-level one. Closing it fully needs a per-chatbot `frame-ancestors` header on the iframe response plus a browser-bound nonce.

## The public demo boundary

The marketing site carries a chat demo that anyone can use without signing in. It is safe for a different reason than the widget: the widget is authorized, the demo has nothing to authorize.

- It has **no tenant**. No workspace, no chatbot row, no knowledge, no stored conversation. Its request contract accepts a list of messages and nothing else, so there is no identifier an attacker could point at another customer's data. Unknown fields are stripped by the schema.
- Its **module graph is the guarantee**. `src/features/public-chatbot/` and the demo route never import `src/server/db`, a repository, `src/server/auth`, an API key or an embed token. A test walks the graph from both entry points and fails on the first forbidden edge, because one careless import would quietly turn a marketing widget into a tenant-data endpoint.
- It **answers only from the published documentation**, which is already tested to contain no credentials and no unsupported claims. The model is instructed to say when something is not supported rather than guess, and to treat anything in a visitor message that tries to change those rules as content.
- **Nothing is persisted.** A visitor's question exists for the length of the request.
- **No credential reaches the browser.** The page posts plain text to a same-origin route; the gateway key is read server-side by `getAiGateway()`.

Its Origin check is about cost, not authorization: it stops the endpoint being trivially reused as a free AI proxy. A non-browser client can set any Origin, so the rate limits below are the real ceiling.

## Abuse and cost control

AI spend is the asset most exposed to abuse, so limits are layered by how trustworthy their key is:

| Limit | Key | Why |
| --- | --- | --- |
| Workspace ceiling, 600/min | Server-resolved workspace id | Cannot be escaped by any caller |
| Chatbot ceiling, 300/min | Server-resolved chatbot id | Bounds one chatbot's exposure |
| Per-visitor, 30/min | Client address | Stops one visitor monopolising the budget |
| Public demo, 600/min | Global | Bounds what the anonymous demo can ever cost, however many visitors arrive |
| Public demo, 12/min | Client address | Stops one visitor, or a naive script, consuming that whole budget |
| Playground, 60/min | Workspace + authenticated user | An authenticated session is not unlimited either |
| Sign-in, 10 per 15 min | Email address | Bounds credential stuffing against one account |
| Sign-in, 50 per 15 min | Client address | Bounds spraying across accounts |

The client address comes from request headers (`cf-connecting-ip`, `x-forwarded-for`), which are only as trustworthy as the proxy in front of the app. That is why every ceiling that must hold is keyed on a server-derived id instead. The limiter is per process and its bucket map is bounded; Cloudflare Rate Limiting is the production control, this is the last line of defence.

## Secrets and configuration

- Only `src/config/env.ts` reads `process.env`, and it is `server-only`. No secret is exposed through `NEXT_PUBLIC_*`.
- `APP_SECRET` signs embed tokens and derives encryption keys; it is required in production and falls back to a fixed development value otherwise.
- Integration credentials are encrypted at rest with AES-256-GCM and are never returned to the client — the UI shows only that a secret is configured, with a replace action.
- Workspace API keys are stored as SHA-256 hashes with a display prefix; the full key is shown exactly once at creation. That is the **inbound** direction only — a hash cannot be sent anywhere.
- **Outbound credentials** (`workspace_credentials`, migration 0026) are the opposite direction and therefore reversibly encrypted: AES-256-GCM bound to `workspace:<id>:credential:<credential id>`. A workflow definition stores only the credential's id; the header is assembled at run time and merged into the request *after* the step summary is built, so the value never reaches the run row or an API response whatever the header is named. Creating one is admin-only, values are write-only, and deletion cascades to the sealed envelope. See ADR 0006.
- Outbound requests initiated from user configuration (URL ingestion, integration connection tests, MCP) reject non-HTTP(S) schemes and loopback, link-local and private address ranges, re-check every redirect hop, pin the connection to the validated address, and carry timeouts and response size caps. See **Outbound requests** above for the whole path and its limits.

## AI-specific risks

- **Prompt injection** is assumed, not prevented. System prompts instruct the model to ignore instructions embedded in user or retrieved content, and — more importantly — tools are never executed implicitly: an agent's tool call is resolved against a registry and surfaced as `simulated` or `approval_required`. No model output reaches a privileged action without a human in the loop.
- **Retrieved content is untrusted.** Knowledge chunks are quoted into the prompt and cited, never executed, and retrieval is always scoped to the caller's workspace.
- **Data minimisation.** Conversations store what was said plus token counts; instructions and internal identifiers are never echoed to visitors.

## Known gaps

These are real and tracked, not oversights:

- Allowed-domain enforcement is browser-facing only (see above).
- Rate limiting is still in-process **at every call site**, so a multi-instance deployment continues to multiply every limit by the instance count. The shared substrate that closes this now exists — `src/server/protection/`, migration 0025, distributed-safe and tested against a real PostgreSQL — but **nothing is wired to it yet**: phase 1 deliberately changed no existing behaviour. See `docs/abuse-prevention-gate.md`; the surfaces are converted in phases 2–5.
- Entitlement enforcement exists (`src/features/billing`, migration 0028) but reaches **two** capabilities: `apiAccess` on minting an API key and `integrations` on creating an outbound credential. That is not an oversight in the wiring - those are the only two limits the pricing catalogue has actually decided. Every other limit is `{ kind: "undecided" }`, and an undecided limit deliberately permits the action while reporting `enforced: false`. A workspace with no plan assigned enforces nothing at all, by design.
- Consequently there is still no usage quota. The metered keys (`messagesPerMonth`, `tokensPerMonth`, `workflowRunsPerMonth`) resolve against `usage_events` and would be enforced the moment a plan states a number, but no plan states one, so no quota is evaluated in practice. `ApiError` expresses `quota_exceeded`, `concurrency_limit`, `not_entitled` and `suspended`; the first and third are now thrown by `requireEntitlement`.
- Sign-up discloses that an email is already registered. This is a deliberate usability trade-off, and it is inconsistent with the anti-enumeration behaviour on sign-in; closing it needs an email channel that does not exist yet.
- No audit-log immutability, no field-level encryption, no secret rotation tooling. The log is append-only by convention, not by grant.
- `activity_log.actor_id` is `ON DELETE SET NULL` and no actor name is snapshotted, so entries by someone since removed from the organization read as "System". Recording a name at write time would fix it and is a deliberate deferral, not an oversight.
- Two reads are looser than the writes beside them: `GET /mcp/servers` (and the server detail) returns `endpointUrl` at `viewer` while every MCP write is `admin`, and `GET /developer/api-keys` lists key names, prefixes and creators at `viewer` while minting and revoking are `admin`. An endpoint can carry a token in its path, so both are candidates for an `admin` floor.
- Knowledge processing and workflow execution run inside the request, so a slow or hostile source ties up a request worker rather than a queue.
- Error tracking is not wired to a provider, so security-relevant failures are only in process logs.
