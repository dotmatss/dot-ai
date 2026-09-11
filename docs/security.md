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
- `proxy.ts` only redirects requests that carry no session cookie, and never touches `/api`. It never redirects *away* from the auth pages: a cookie can outlive its row, and bouncing on cookie presence alone would trap that browser in a loop it cannot escape, because the cookie is HttpOnly. The auth pages redirect only after the Data Access Layer confirms a real session.

## Authorization and tenant isolation

Two independent layers, described fully in [ADR 0002](adr/0002-tenant-isolation.md):

1. **Explicit scoping.** Every tenant table carries `workspace_id`; repository SQL always filters on it, using the workspace id resolved from the caller's verified membership — never one supplied by the client. Pages call `requireWorkspaceAccess`, route handlers are wrapped in `workspaceRoute(handler, { minimumRole })`.
2. **Row Level Security.** Policies restrict rows to the workspace named in the transaction-local `app.workspace_id`, set by `withWorkspace()`. Policies are `FORCE`d (migration 0013), because RLS does not apply to a table's owner and the application usually connects as that role. The predicate is cast-safe (migration 0014): PostgreSQL does not guarantee OR short-circuiting, and the earlier version could evaluate `''::uuid` and fail an unrelated query on a pooled connection.

Roles are organization-level: `owner > admin > member > viewer`. Reads need `viewer`, writes `member`, destructive or administrative actions `admin` or `owner`. UI gating is cosmetic; the server re-checks every time.

Unknown or inaccessible workspaces return **404**, not 403, so their existence is not disclosed.

`tests/unit/rls.integration.test.ts` proves the second layer by connecting as a non-superuser and asserting that a query with no `workspace_id` predicate still sees only one tenant. **Deploy with a non-superuser database role**: superusers bypass RLS entirely.

## Request-level protections

- **CSRF.** Cookies are `SameSite=Lax`; mutating API routes additionally require the `Origin` to match the host and an `X-Requested-With: fetch` marker that a cross-site form cannot set. Server Actions rely on the framework's own Origin check.
- **Validation.** Every request body goes through `parseJsonBody(request, schema)` and every query string through `parseSearchParams`, both Zod. Failures become a `422` with per-field detail.
- **Output shaping.** Services return mapped domain objects, never raw rows; errors leave through one envelope (`{ error: { code, message, details } }`) with no internals. Upstream AI gateway error bodies are logged server-side and replaced with a generic message, because that stream is read by anonymous visitors.
- **Server-only code** is marked with the `server-only` package, so a client import fails the build rather than shipping database access to the browser.

## The embed boundary

The widget is the only path from an anonymous third-party page to a tenant's chatbot. See [ADR 0004](adr/0004-embed-security.md).

- The loader script holds no secret; the embed key is a public identifier.
- The iframe document is served only when the chatbot is `active` and the parent origin matches the chatbot's allowed-domain list (exact host or `*.example.com`; a subdomain does not inherit an exact entry). Workspace members with an editing role get a preview token from the app origin so they can test an inactive chatbot — viewers do not, because a preview token can spend model budget.
- That decision is carried in a short-lived HMAC-signed token bound to `{ embedKey, origin }`, which `/api/public/chat` re-verifies along with status and domain. The token payload is signed, not encrypted, and deliberately contains nothing sensitive.
- Application routes send `X-Frame-Options: DENY` and `frame-ancestors 'none'`; only `/embed/*` may be framed.

**Known limitation, stated plainly:** the parent origin is derived from the `Referer` header, which a non-browser client can set freely. A server-side caller that knows a published embed key can therefore mint a token and use the chatbot outside its allowed domains. Browsers cannot do this cross-origin, and the cost of such abuse is bounded by the ceilings below, but allowed-domain enforcement should be understood as a browser-facing control, not an API-level one. Closing it fully needs a per-chatbot `frame-ancestors` header on the iframe response plus a browser-bound nonce.

## The public demo boundary

The marketing site carries a chat demo that anyone can use without signing in. It is safe for a different reason than the widget: the widget is authorized, the demo has nothing to authorize.

- It has **no tenant**. No workspace, no chatbot row, no knowledge base, no stored conversation. Its request contract accepts a list of messages and nothing else, so there is no identifier an attacker could point at another customer's data. Unknown fields are stripped by the schema.
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
- Workspace API keys are stored as SHA-256 hashes with a display prefix; the full key is shown exactly once at creation.
- Outbound requests initiated from user configuration (URL ingestion, webhook tests, workflow HTTP steps) reject non-HTTP(S) schemes and loopback, link-local and private address ranges, re-checking every redirect hop, with timeouts and response size caps.

## AI-specific risks

- **Prompt injection** is assumed, not prevented. System prompts instruct the model to ignore instructions embedded in user or retrieved content, and — more importantly — tools are never executed implicitly: an agent's tool call is resolved against a registry and surfaced as `simulated` or `approval_required`. No model output reaches a privileged action without a human in the loop.
- **Retrieved content is untrusted.** Knowledge chunks are quoted into the prompt and cited, never executed, and retrieval is always scoped to the caller's workspace.
- **Data minimisation.** Conversations store what was said plus token counts; instructions and internal identifiers are never echoed to visitors.

## Known gaps

These are real and tracked, not oversights:

- Allowed-domain enforcement is browser-facing only (see above).
- Rate limiting is in-process; a multi-instance deployment multiplies every limit by the instance count.
- There is no usage quota or billing enforcement yet, only metering in `usage_events`.
- Sign-up discloses that an email is already registered. This is a deliberate usability trade-off, and it is inconsistent with the anti-enumeration behaviour on sign-in; closing it needs an email channel that does not exist yet.
- No audit-log immutability, no field-level encryption, no secret rotation tooling.
- Knowledge processing and workflow execution run inside the request, so a slow or hostile source ties up a request worker rather than a queue.
- Error tracking is not wired to a provider, so security-relevant failures are only in process logs.
