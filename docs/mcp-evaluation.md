# MCP integration — phase 1

**Status: Phase 1 complete. Phase 2a (egress pinning), 2b (execution), 2c (approvals queue) and 2d (OAuth 2.1) complete. MCP tools now execute; see `docs/mcp-phase2-gate.md` for what each phase delivered and what remains.**

| | |
| --- | --- |
| Protocol revision | 2026-07-28 |
| Transport | Streamable HTTP over HTTPS only. No stdio, enforced by a test |
| Scope | Agents only. Not chatbots, not workflow execution |
| Execution | Resolved and recorded, never run. Same as the six built-in agent tools |
| Dependency | `@modelcontextprotocol/client` 2.0.0, one package |
| Persistence | Four tables, migration `0015_mcp.sql`, applied |

## Decision record

Approved by the product owner, and implemented as described:

| Decision | Outcome |
| --- | --- |
| A — Streamable HTTP only, no stdio ever | Implemented. `MCP_TRANSPORTS` is `["http"]`; `tests/unit/mcp-isolation.test.ts` walks the feature's source and fails on any reference to the SDK's stdio subpath, `StdioClientTransport`, `child_process`, `spawn` or `cross-spawn` |
| B — Static header credential; OAuth 2.1 deferred | Implemented. Bearer credentials use the SDK's `AuthProvider` so the specification's 401 handling applies; a non-standard header name is set directly |
| C — Install the client SDK, conditional on verification | Verified, then installed. See [§14](#14-required-dependencies) |
| D — Four new tables | Implemented as `0015_mcp.sql`, with RLS enabled and forced on all four |
| E — Attach MCP tools to agents | Implemented **additively**, with no change to `AgentToolSetting`. See [§8](#8-agent-integration) |
| F — Record rather than execute | Implemented. `resolveMcpToolCall` returns a status and a reason; nothing calls a tool |
| G — Agents only, not chatbots | Implemented by omission: nothing in the chatbots feature references MCP |

## What is built

| Module | What it does |
| --- | --- |
| `src/features/mcp/types.ts` | Domain contracts. Client-safe, no Zod, no SDK |
| `src/features/mcp/constants.ts` | Limits, status and risk metadata, and the advisory risk suggestion |
| `src/features/mcp/tool-ref.ts` | Namespacing, `mcp.{serverSlug}.{toolName}` |
| `src/features/mcp/grants.ts` | Staleness, grant state, and `resolveMcpToolCall` — the security decision, as pure functions |
| `src/features/mcp/agent-attachment.ts` | The agent half of the `agents.tools` jsonb |
| `src/features/mcp/server/tool-identity.ts` | The canonical representation and the content hash |
| `src/features/mcp/server/tool-validation.ts` | Validation of untrusted tool metadata |
| `src/features/mcp/server/mcp-client.ts` | The only module importing the SDK. Probe and discovery |
| `src/server/http/egress-guard.ts` | The shared guarded fetch, extracted so there is one implementation |
| `src/features/mcp/schemas.ts` | Request validation, including the https-only endpoint policy |
| `src/features/mcp/server/mcp-repository.ts` | Persistence, on Drizzle |
| `src/features/mcp/server/mcp-service.ts` | Authorize, apply the rules, persist |
| `src/features/mcp/api.ts`, `queries.ts`, `mutations.ts` | Client data layer |
| `src/features/mcp/components/` | Server list, connect dialog, approval screen, server actions |
| `src/server/db/migrations/0015_mcp.sql` | Four tables, RLS enabled and forced, one CHECK constraint |
| `src/server/db/schema/mcp.ts` | The Drizzle description, held to the migration by the drift test |

Tests: `mcp-tool-identity`, `mcp-tool-validation`, `mcp-grants`, `mcp-agent-attachment`, `mcp-isolation`, `mcp-schemas`, `mcp-egress-guard`, `mcp-persistence.integration`, and `mcp-tool-approvals` for the UI.

## What is deliberately not built

No execution. `resolveMcpToolCall` decides whether a call *would* be allowed and records the decision; nothing calls a tool. That matches all six built-in agent tools, which have always resolved and recorded rather than run.

Also absent, and each for a stated reason: the `mcp_tool_calls` table (it records executions, and there are none), OAuth (phase 2), workflow MCP nodes (phase 2), chatbot MCP (phase 2), `x-mcp-header` mirroring (a tool using it is excluded with a reason), and plan enforcement (there is no entitlement resolver to enforce against).

---

This document was written before implementation and is kept as the record of the reasoning. The sections below describe the protocol and the design; where implementation has since settled a question, it says so.

Every claim about the Model Context Protocol below was read from the specification during this evaluation, not from memory. **The protocol changed substantially in the 2026-07-28 revision**, and several things that were true a year ago are no longer true. Where something could not be confirmed it is marked **UNVERIFIED**.

---

## 0. What the protocol actually looks like now

The current revision is **2026-07-28**. Facts that matter most to us:

| Fact | Consequence for this platform |
| --- | --- |
| **Sessions and the `initialize` handshake were removed** (SEP-2575, SEP-2567). There is no `Mcp-Session-Id` | No connection pool, no session store, no reconnect logic. Every call is an independent authenticated HTTP POST. "Connection status" is the result of the last probe, not a live socket |
| **Two standard transports**: `stdio` (client launches a subprocess) and **Streamable HTTP** (one POST endpoint). Legacy HTTP+SSE is deprecated | We support Streamable HTTP only. See §2 |
| Every POST **MUST** carry `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` (for `tools/call`, `resources/read`, `prompts/get`) | Protocol plumbing, and a reason to use the SDK rather than hand-roll |
| Servers **MUST** reject a header that disagrees with the body: HTTP 400, JSON-RPC `-32020` `HeaderMismatch` | Our client must mirror correctly or every call fails |
| Tool parameters may be marked `x-mcp-header`, and **clients MUST support mirroring them into `Mcp-Param-{Name}` headers**, with a Base64 sentinel encoding for unsafe values | A conformance obligation that is easy to miss. Also an exfiltration surface: header values are visible to intermediaries |
| Cancellation on Streamable HTTP is **closing the SSE response stream**. `notifications/cancelled` is stdio-only | Cancellation maps onto `AbortSignal`, which our streaming stack already threads through |
| `tools/list` supports pagination and returns `ttlMs` / `cacheScope` (SEP-2549) | Tool lists are cacheable, with the server stating for how long |
| `tools/list_changed` arrives only on a long-lived `subscriptions/listen` stream | We will poll on demand instead of holding a stream open per customer server |
| **Roots, sampling and logging are deprecated** (SEP-2577). Server-initiated elicitation and sampling are replaced by **Multi Round-Trip Requests**: a result of `resultType: "input_required"` carrying `inputRequests`, retried with `inputResponses` | A server can ask *us* for input mid-call. This is a distinct concept from our own human approval, and it must be explicitly handled or explicitly refused. See §12 |
| Authorization is OAuth 2.1 with RFC 9728 protected resource metadata (**MUST**), RFC 8414 or OIDC discovery, RFC 8707 resource indicators (**MUST**), RFC 9207 `iss` validation. **Dynamic Client Registration is deprecated** in favour of Client ID Metadata Documents | Full OAuth support is a substantial build. See §3 |
| For stdio, the spec says implementations **SHOULD NOT** use the OAuth flow and should take credentials from the environment | Reinforces that stdio is a different, more dangerous thing |
| Tool annotations exist (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) but **"clients MUST consider tool annotations to be untrusted unless they come from trusted servers"** | The permission model cannot be built on them. See §7 |

The specification's own security guidance is blunt about the rest: annotations "cannot resist prompt injection", "a server can lie about its tool's behavior", and "if you need a guarantee that a tool can't exfiltrate data, that's a job for network controls or sandboxing, not a boolean hint".

---

## 1. MCP client architecture

The platform is an **MCP client only**. It does not become an MCP server, and customers are not asked to expose one.

```text
Browser (configure, view, monitor — never executes)
   │  /api/v1/w/[slug]/mcp/...
   ▼
MCP feature service  ── authorize (requireWorkspaceAccess) ── entitlement check
   │
   ▼
MCP execution boundary        src/features/mcp/server/
   ├── resolve server + sealed credential   (workspace-scoped)
   ├── egress guard                          (SSRF, HTTPS, redirect re-check)
   ├── MCP client transport                  (Streamable HTTP)
   ├── grant check                           (server + tool + pinned hash)
   └── record call                           (audit + usage)
   │
   ▼
Customer's remote MCP server ──▶ their external system
```

Two rules keep the protocol from leaking:

- **Nothing above the execution boundary knows MCP exists.** The agent runtime asks "run tool X on server Y with these arguments" and receives a normalised result. `AgentToolCallRecord` already has exactly that shape.
- **Nothing below the boundary knows about agents, chatbots or workflows.** The boundary takes a workspace id, a server id, a tool name and arguments.

New feature, following the existing conventions:

```text
src/features/mcp/
  types.ts            domain types, no Zod, serialisable
  constants.ts        risk classes, limits, status metadata
  schemas.ts          request validation
  tool-identity.ts    pure: namespacing, tool hashing, grant matching
  api.ts queries.ts mutations.ts
  server/
    mcp-repository.ts     SQL, workspace-scoped
    mcp-service.ts        authorize → apply rules → repository
    mcp-client.ts         the only module that imports the MCP SDK
    mcp-egress.ts         destination policy for MCP endpoints
    mcp-execution.ts      grant check → call → normalise → record
  components/
```

---

## 2. Supported transports — the most important decision

**Recommendation: Streamable HTTP only, HTTPS only. Do not support stdio. Not in phase 1, and I would argue not ever on our infrastructure.**

`stdio` means the client launches the MCP server as a subprocess. If a customer can configure a stdio server, then a customer can make our servers execute an arbitrary command as our service account, inside our network, with our cloud credentials available on the instance metadata endpoint. That is not a tool integration; it is remote code execution with extra steps. The spec's own security page catalogues exactly this (`Local MCP Server Compromise`: arbitrary code execution, data exfiltration, privilege escalation) and its mitigations assume the operator is the same person as the user — which is precisely the assumption a multi-tenant SaaS cannot make.

If customers need to reach a local or private MCP server later, the answer is a customer-run outbound connector, not us spawning processes.

Also excluded: the deprecated 2024-11-05 HTTP+SSE transport. New implementations **SHOULD NOT** adopt it.

---

## 3. Authentication approach

Two phases, because these are very different amounts of work.

**Phase 1 — static credential.** The customer supplies a header credential (typically `Authorization: Bearer …`, sometimes a vendor header). We seal it and send it on every request. This covers the large majority of remote MCP servers in practice and needs no redirect endpoint, no client registration and no token refresh.

**Phase 2 — OAuth 2.1.** Doing this properly per the spec means: discovery via `WWW-Authenticate` → RFC 9728 protected resource metadata → RFC 8414 or OIDC authorization server metadata; a Client ID Metadata Document we host (DCR is deprecated); PKCE; the `resource` parameter on both authorization and token requests (RFC 8707, **MUST**); recording the expected issuer and validating `iss` on the callback (RFC 9207); refresh tokens; and step-up re-authorization on `403 insufficient_scope` with the union of previously granted scopes. Every one of those discovery fetches is an SSRF vector the spec explicitly warns about, because the URLs come from the MCP server.

This is a feature in its own right. **Decision needed: is phase 1 alone acceptable to start?**

**Never, in either phase:** accept or forward a token that was not issued for the target server. Token passthrough is explicitly forbidden by the spec and is how the confused-deputy problem happens.

---

## 4. Credential storage strategy

Reuse what already exists, unchanged. `src/features/integrations/server/secret-box.ts` is AES-256-GCM with a key derived from `APP_SECRET` by scrypt, a fresh IV per seal, and — the part that matters here — the **context bound as additional authenticated data**. Sealing with a context of `mcp:{workspaceId}:{serverId}` means a ciphertext lifted from one workspace's row into another's fails to open rather than silently decrypting. Tenant isolation survives a row-level mistake.

Rules: credentials are write-only from the browser's point of view; the API returns `hasCredential: true` and never the value; a credential is never logged, never echoed in an error, and never placed in a tool argument or a mirrored header.

---

## 5. MCP server lifecycle

Because the protocol is now stateless, the lifecycle is much simpler than it would have been a year ago:

| State | Meaning | How it is reached |
| --- | --- | --- |
| `draft` | Configured, never successfully probed | Created |
| `active` | Last probe succeeded and tools were discovered | Probe + `tools/list` |
| `error` | Last probe failed | Probe failure; the reason is stored, sanitised |
| `unauthorized` | Server answered 401 or 403 | Distinguished from `error` because the fix is different |
| `disabled` | Customer switched it off without deleting it | Explicit action |

There is no "connected" state, because there is no connection. A probe is: resolve credential → egress check → `tools/list`. Disconnecting deletes the server row and its grants, and cascades.

---

## 6. Tool discovery architecture

`tools/list`, following pagination, with a bounded page count and a total tool cap. The result is **persisted as a snapshot**, not held in memory, for three reasons: the permission UI needs something to render without hitting the customer's server, `ttlMs`/`cacheScope` tell us caching is expected, and — most importantly — a stored snapshot is what makes the next section possible.

Each discovered tool is stored with a **content hash** over the fields that determine what the tool does: `name`, `description`, `inputSchema`, `outputSchema`, and the annotations. Re-discovery compares hashes.

**This is the rug-pull defence, and it is not in the brief.** A customer approves `search_contacts` on Monday. On Tuesday the server operator redefines that same tool name to exfiltrate the CRM, or changes its description to carry instructions to the model. Nothing in MCP prevents this; the tool list "**MAY** change over time". So: **a grant is pinned to the hash it was approved at. If the hash changes, the grant becomes `stale` and the tool stops being offered to the model until a human re-approves it.** A tool that disappears has its grant marked `orphaned`, not silently deleted.

Tool names are namespaced as `mcp.{serverSlug}.{toolName}` before they reach any model. The spec is explicit that names are unique only within a server and that aggregating clients **SHOULD** disambiguate.

---

## 7. Tool permission model

Default deny, per tool, at the (server, tool) pair. Nothing is granted by connecting a server.

The risk class is **ours, chosen by the customer at approval time** — not the server's annotation:

```text
read         a tool that only reads          → may run without approval
write        creates or modifies             → approval by default
destructive  deletes, sends, pays, escalates → approval always, not switchable off in phase 1
```

Annotations are shown in the approval UI as **the server's claim**, labelled as such, and used to pre-select a risk class the customer can override. They are never the enforcement input. The spec requires clients to treat them as untrusted, and the annotations interest group is explicit that "a server can lie about its tool's behavior".

A grant record is therefore: workspace, server, tool name, approved hash, risk class, approval requirement, who approved it and when. Enforcement happens in `mcp-execution.ts`, server-side, reading the grant from the database — never from the request, and never from anything the browser sent.

---

## 8. Agent integration

The existing model is closer to this than I expected. `AgentToolSetting` already carries `enabled`, `config` and `requiresApproval`; `resolveAgentToolCall` already returns `executed | simulated | approval_required | unavailable | unknown_tool`; and the UI already renders tool activity through `AgentToolSteps`. The HITL seam is built.

One change is needed. `AgentToolSetting.toolId` is currently a closed union of six built-in ids. It becomes a discriminated reference:

```ts
type AgentToolRef =
  | { source: "builtin"; toolId: AgentToolId }
  | { source: "mcp"; serverId: string; toolName: string };
```

`normalizeToolSettings` already drops unknown ids when reading the `agents.tools` jsonb, so old rows keep working and new rows are readable by old code paths as "unknown, dropped" rather than as a crash. The agent tools UI groups built-in and MCP tools separately, and MCP tools are visibly attributed to their server — requirement 9.

**This is a jsonb read-model change and needs approval** (§17).

---

## 9. Workflow integration

A new node type in the existing registry: `tool.mcp`, category `tool`, alongside `tool.http_request`. The namespaced `WORKFLOW_NODE_TYPES` convention already accommodates it.

Its config is a server id, a tool name and an explicit outbound opt-in, mirroring how `tool.http_request` already requires `allowOutbound` before a real request is made. The node descriptor and the visual builder stay free of MCP internals: the executor calls the same execution boundary the agent runtime uses.

Note for whoever implements this: the workflow feature's own egress guard (`domain/outbound.ts`) documents a known DNS-rebinding gap. MCP must use the stronger guard (§10), not that one.

---

## 10. Security boundaries

| Risk | Control |
| --- | --- |
| **SSRF** — an MCP endpoint, or an OAuth discovery URL taken from the server, pointing at `169.254.169.254`, `localhost` or private space | Reuse the strong guard from `integrations/server/connection-test.ts`: scheme and port policy, **DNS resolution checked against the address policy**, redirects followed manually with the policy re-applied per hop, one wall-clock budget. Not the weaker workflow guard |
| **Arbitrary code execution** | No stdio (§2) |
| **Prompt injection via tool descriptions and tool output** | Tool descriptions and results enter the model as **data, never as instructions**, in a delimited block that says so, exactly as retrieved knowledge already does. This mitigates; it does not solve. Stated as a known limitation |
| **Rug pull / tool redefinition** | Grants pinned to a content hash (§6) |
| **Excessive permissions** | Default deny; per-tool grants; destructive tools always gated |
| **Data exfiltration through mirrored headers** | `x-mcp-header` values are visible to intermediaries. Refuse to mirror any parameter whose value came from a credential, and honour the spec's `x-mcp-header` validation rules — **clients MUST exclude a tool whose annotation violates them** |
| **Credential leakage** | Sealed at rest with workspace-bound AAD; never returned, never logged; errors name the host and status only |
| **Tool impersonation / collision** | Namespaced tool identity (§6) |
| **Malicious tool metadata** | Every discovered tool validated with Zod before storage: name charset and length, `inputSchema` must be a JSON Schema object, caps on description length, tool count and schema depth. A malformed tool is excluded, not fatal |
| **Replay** | Nothing to replay: no protocol sessions. Our own call records carry an idempotency key so a retried execution is recorded once |
| **Sensitive output leakage** | Response size cap; results stored truncated; the observability view redacts by default |
| **Cross-tenant access** | §11 |
| **Cost abuse** | Per-workspace and per-server rate limits through the existing `checkRateLimits`, and a tool-call timeout |

---

## 11. Tenant isolation strategy

Unchanged from the rest of the platform, which is the point. Every new table carries `workspace_id`, every query filters on it explicitly, and every new table gets the full RLS treatment from `docs/feature-conventions.md`:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY <t>_workspace_isolation ON <t>
  USING (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  WITH CHECK ( … same … );
```

`tests/unit/rls.integration.test.ts` asserts this for every table with a `workspace_id` column, so a migration that skips it fails the suite. The workspace id always comes from `requireWorkspaceAccess`, never from a request body. Credentials are additionally bound to the workspace cryptographically (§4).

---

## 12. Human-in-the-loop strategy

Two different things share this name and must not be conflated.

**Our approval** — a person authorises a tool call our model wants to make. The seam exists: `requiresApproval` on the grant, `approval_required` as a resolution status, and a UI that already renders it. Phase 1 records an approval-required call and does not run it, which is exactly what every agent tool does today. Phase 2 adds an approvals queue table so a person can approve or deny a pending call and the run resumes.

**The server's request for input** — MRTR. A server may answer `tools/call` with `resultType: "input_required"` carrying `inputRequests` (an elicitation form, say), expecting us to retry with `inputResponses`. **Phase 1 recommendation: detect it and refuse it cleanly**, recording the call as `input_required` and surfacing it to the customer, rather than half-implementing an interactive loop inside an autonomous agent turn. Handling it properly means deciding who answers the question, and for an unattended agent run the answer is usually "nobody".

---

## 13. Observability and audit strategy

A dedicated `mcp_tool_calls` table rather than overloading `activity_log`, because these are high volume and their retention will differ: workspace, server, tool name, resolved status, duration, argument and result **digests plus truncated previews**, error class, and the conversation or workflow run that caused it.

Alongside it: `recordActivity()` for the configuration events a customer should see in the audit trail (server connected, credential replaced, tool granted, grant revoked, grant went stale), and `recordUsage()` for metering, using a new `mcp_tool_call` kind so usage-based limits can attach later without a second metering mechanism.

The execution view shows tool, server, status, duration, and input and output **with redaction on by default**. It never shows a credential, and it never shows a raw mirrored header.

---

## 14. Required dependencies

| Package | Version | Verdict |
| --- | --- | --- |
| `@modelcontextprotocol/client` | 2.0.0 (`engines.node >= 20`; we run 22.17) | **Recommended.** The v2 line is the one that implements protocol revision 2026-07-28 |
| `@modelcontextprotocol/server` | 2.0.0 | **No.** We are a client. We are not exposing an MCP server |
| `@modelcontextprotocol/sdk` | 1.30.0 | **No.** The v1 monolithic package is the pre-2026-07-28 era. Installing it alongside v2 would be two overlapping implementations, which the brief forbids |

One dependency. The alternative is hand-rolling the client, and I do not recommend it: the revision requires correct header mirroring with a Base64 sentinel encoding, header/body agreement, `x-mcp-header` support, pagination, MRTR result handling and version negotiation with fallback. That is a conformance surface that will keep moving.

### Verification result — the gate that had to pass first

The condition on installing was that our SSRF guard must sit **inside** the SDK's request path. Verified by downloading the tarball with `npm pack` and reading its type declarations, before adding anything to `package.json`:

| Checked | Result |
| --- | --- |
| Custom fetch | `StreamableHTTPClientTransportOptions.fetch?: FetchLike`, documented as *"Custom fetch implementation used for all network requests"* |
| Its signature | `type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>` — a standard fetch, so `redirect: "manual"` and per-hop revalidation are ours to control |
| Redirect bypass | None available. The transport has no other network path; it holds a single `_fetch` |
| DNS and IP validation | Ours, because it runs inside our fetch before each hop |
| OAuth discovery fetches | Every discovery helper also takes `fetchFn`, so the phase-2 metadata fetches the specification warns about can be guarded too |
| stdio separation | A separate subpath export (`@modelcontextprotocol/client/stdio`). Never imported, and a test enforces that |
| Runtime | `engines.node >= 20`; this project runs 22.17 |
| Zod | `^4.2.0`, matching the project's Zod 4 |
| Testability | `InMemoryTransport` is exported, so a client can be driven against a fake server with no network |

The API surface was then confirmed by compiling against the installed package rather than by reading the documentation site: `new Client({ name, version })`, `client.connect(transport)`, `client.listTools(params?)`, `client.callTool(params)`, `client.close()`, and `AuthProvider { token(): Promise<string | undefined> }`.

Two residual notes. The transport type still carries `sessionId` and `reconnectionOptions`, which are backward-compatibility affordances for pre-2026-07-28 servers; we set neither. And `x-mcp-header` parameter mirroring is **not** implemented, so a tool using it is excluded with a stated reason rather than called in a way that would fail header validation on every request.

---

## 15. Database implications

Four new tables. No change to any existing table.

```text
mcp_servers        workspace_id, name, slug, endpoint_url, transport('http'),
                   auth_kind('none'|'header'), status, last_probe_at,
                   last_probe_ok, last_probe_message, tool_count,
                   created_by, created_at, updated_at
                   UNIQUE (workspace_id, slug)

mcp_server_secrets workspace_id, mcp_server_id, ciphertext, iv, tag, header_name,
                   created_at, updated_at        -- mirrors integration_secrets
                   UNIQUE (mcp_server_id)

mcp_server_tools   workspace_id, mcp_server_id, name, title, description,
                   input_schema jsonb, output_schema jsonb, annotations jsonb,
                   content_hash, first_seen_at, last_seen_at, removed_at
                   UNIQUE (mcp_server_id, name)

mcp_tool_grants    workspace_id, mcp_server_id, tool_name, approved_hash,
                   risk_class('read'|'write'|'destructive'),
                   requires_approval, state('active'|'stale'|'orphaned'),
                   granted_by, granted_at
                   UNIQUE (mcp_server_id, tool_name)

mcp_tool_calls     workspace_id, mcp_server_id, tool_name, status, duration_ms,
                   argument_digest, result_digest, argument_preview,
                   result_preview, error_class, conversation_id, workflow_run_id,
                   idempotency_key, created_at
```

All five carry `workspace_id`, RLS enabled and forced, and a `*_workspace_isolation` policy with the cast-safe predicate. The Drizzle description in `src/server/db/schema/` gets matching definitions, and `tests/unit/schema-drift.integration.test.ts` will then hold them to the migration.

Grants and tools are separate tables on purpose: a discovered tool is a fact about the server, a grant is a decision by a human, and conflating them is how a re-discovery silently re-grants something.

---

## 16. API implications

Under the existing versioned, workspace-scoped surface, through `workspaceRoute` with its origin, session, membership and role checks:

```text
GET    /api/v1/w/[slug]/mcp/servers                     list        viewer
POST   /api/v1/w/[slug]/mcp/servers                     create      admin
GET    /api/v1/w/[slug]/mcp/servers/[id]                detail      viewer
PATCH  /api/v1/w/[slug]/mcp/servers/[id]                update      admin
DELETE /api/v1/w/[slug]/mcp/servers/[id]                disconnect  admin
POST   /api/v1/w/[slug]/mcp/servers/[id]/probe          test        admin
POST   /api/v1/w/[slug]/mcp/servers/[id]/discover       refresh     admin
GET    /api/v1/w/[slug]/mcp/servers/[id]/tools          list tools  viewer
PUT    /api/v1/w/[slug]/mcp/servers/[id]/grants         set grants  admin
GET    /api/v1/w/[slug]/mcp/calls                       audit       viewer
```

`admin` for anything that changes what an agent can reach, because granting a destructive tool is a privilege escalation. There is **no** endpoint that executes a tool on the browser's behalf: execution happens only inside an agent turn or a workflow run.

This is the opposite direction from our public API, and the distinction stays visible in the routing: `/api/v1/public/chat` is a customer calling us; `/api/v1/w/[slug]/mcp/*` is us configuring what we will call.

---

## 17. Recommendation

Adopt MCP as a client-side integration capability, Streamable HTTP only, in two phases.

**Phase 1 — connect, discover, permit, observe.** Everything in §§1–11 and 13–16, with tool calls resolved and recorded rather than executed. That is exactly how all six built-in agent tools behave today, so it ships a coherent product rather than making MCP the one tool path that can act. Customers get: connect a server, see what it offers, choose what is allowed, attach to an agent, and watch what the model tried to do.

**Phase 2 — execute.** Turn on real execution behind grants, add the approvals queue, and add OAuth. This is the phase that needs the most care and the least guessing, and it is much safer once phase 1 has produced real traffic to look at.

### Decisions I need from you

| # | Decision | My recommendation |
| --- | --- | --- |
| A | Streamable HTTP only; **no stdio, ever, on our infrastructure** | Strongly recommended. Reconsidering it means accepting remote code execution from customer configuration |
| B | Phase 1 authentication is a static header credential; OAuth 2.1 deferred to phase 2 | Recommended. Full OAuth is its own project |
| C | Install `@modelcontextprotocol/client` v2.0.0 — one dependency — conditional on confirming we can inject our own `fetch` for the egress guard | Recommended, with that check first |
| D | Four new tables and one migration | Required for any of this |
| E | Change `AgentToolSetting.toolId` to a discriminated `AgentToolRef` | Required to attach MCP tools to agents |
| F | **Does phase 1 execute tools, or record them like every other tool does today?** | Record. Making MCP the first executing tool path is a bigger product change than it looks |
| G | Chatbots have no `tools` column. Do chatbots get MCP in phase 1, or agents only? | Agents only. Chatbots are public-facing, which raises the stakes, and it needs a schema addition |

### Two corrections to the brief

**Requirement 21 assumes an entitlement architecture "introduced for Polar billing". It does not exist.** What exists is a pricing page with a plan catalogue and an `EntitlementKey` union, both explicitly marked as drafts. There is no subscription state, no entitlement resolver and no enforcement anywhere. MCP limits therefore cannot be hung off entitlements yet. I propose adding `mcpServers` and `mcpTools` to the existing `EntitlementKey` union so the keys exist and the pricing page can show them as undecided, with enforcement arriving when the entitlement layer does.

**The Polar architecture gate was never delivered.** The research ran in a background workflow that did not survive the session restart, so there is no recommendation to show you. It needs re-running before billing work starts.
---

## 18. What was implemented, and what it cost

### The four tables

`0015_mcp.sql` creates `mcp_servers`, `mcp_server_secrets`, `mcp_server_tools` and `mcp_tool_grants`, each with `workspace_id`, RLS enabled **and forced**, and the cast-safe `*_workspace_isolation` policy. `tests/unit/rls.integration.test.ts` asserts that convention for every table carrying `workspace_id`, so a migration that skipped it would fail the suite.

The fifth table listed in §15, `mcp_tool_calls`, was **not** created. §15's prose says "four tables" while its diagram lists five, and the resolution is that the call record belongs with execution: an always-empty audit table would read as though calls were being recorded when none can be.

### One constraint the schema description cannot express

```sql
CONSTRAINT mcp_tool_grants_destructive_requires_approval
  CHECK (risk_class <> 'destructive' OR requires_approval)
```

A destructive grant cannot exist without an approval requirement. The service normalises it, the UI disables the switch, and this refuses the write regardless. Three layers, because it is the control that stops an agent deleting things unattended. Drizzle has no vocabulary for a CHECK, so it lives only in the migration and is noted in `src/server/db/schema/index.ts`.

### Three bugs the integration tests found

Worth recording, because all three were invisible to the type checker and would have failed in production:

1. **Ambiguous column reference (42702).** Interpolating Drizzle columns into a correlated subquery renders bare column names, and inside a subquery over another table a bare `id` is ambiguous between the two relations. The subqueries are now written with explicit aliases and qualified outer references.
2. **Array parameter (22P02 / 42809).** A hand-written `<> ALL(${array})` expands a JS array into separate bind parameters rather than a PostgreSQL array. Replaced with `notInArray`.
3. **The server limit works.** The first run of the persistence test exhausted `MCP_LIMITS.maxServersPerWorkspace` and failed on the limit rather than on what it was testing. The test now uses a fresh workspace per case.

### API surface

Nine handlers were designed in §16; eight exist. The audit endpoint is absent because the table it would read is. `viewer` reads; `admin` changes anything that affects what an agent can reach, because approving a destructive tool is a privilege escalation. The probe and discover routes are rate limited on workspace and server ids, both server-derived, because they make outbound requests to an address a customer chose.

### What a customer can do

Connect a server, test it, discover its tools, read what each one claims and what it actually says, classify its risk, approve or revoke it, disable a server without losing approvals, and disconnect it entirely. A tool that changes after approval stops being offered until a person looks again.

### Phase 2 limitations, stated plainly

- **Nothing executes.** The resolution path is complete and tested; the call is recorded rather than made.
- **No approvals queue.** `approval_required` is a resolution status, not yet a queue a person works through.
- **Static credentials only.** OAuth 2.1, with the discovery, `resource` indicator and `iss` validation the specification requires, is phase 2.
- **Agents only.** Chatbots have no tools column and are public-facing.
- **No workflow node.** The seam is the execution boundary; `tool.mcp` is not registered.
- **No entitlement enforcement.** `MCP_LIMITS.maxServersPerWorkspace` is a constant, which is the configurable seam requested until an entitlement resolver exists.
- **Header name changes need the credential re-entered.** Re-sealing requires the plaintext, and the request is refused rather than half-applied.
- **DNS time-of-check to time-of-use.** The guard resolves and checks before connecting, but does not pin the socket to the checked address. Closing that needs a custom agent; the layered controls are the mitigation the specification itself recommends.
