# Abuse prevention and resource protection — architecture gate

**Status: architecture approved (see §9). Phase 1 implemented; Phases 2–6 not started.**

Every claim below was read out of this repository at the commit this document was
written against. Where something could not be verified from the code it says so.

The short version: this platform is **not starting from zero**. It already has a
rate limiter, execution budgets, per-turn tool caps, a metering table, a
lifecycle kill-switch and an entitlement vocabulary. What it does not have is a
place to keep a counter that more than one process can agree on — and that single
gap is what makes every ceiling in the product advisory rather than binding.

---

## 1. What exists today

### 1.1 Rate limiting

`src/server/http/rate-limit.ts` — an in-memory fixed-window limiter. One `Map`
per process, bounded at 20,000 buckets, swept every 60s. Its own header comment
is candid that it is "the last line of defence" and that "Cloudflare Rate
Limiting (or a shared store) is the production control."

Eleven call sites, and the key choices behind them are already correct:

| Surface | Keys | Ceiling |
| --- | --- | --- |
| `/api/v1/public/chat` | workspace, then API key | 600/min, 120/min |
| `/api/public/chat` (widget) | workspace, chatbot, chatbot+IP | 600/min, 300/min, 30/min |
| `/api/public/demo/chat` | global, then IP | 600/min, 12/min |
| Playground chat | workspace + user | 60/min |
| Workflow runs | workspace + user | 20/min |
| MCP probe / discover | workspace (+ server) | per route |
| Integration test | workspace | 20/min |
| Sign-in | email, then IP | 10 / 15min, 50 / 15min |
| Sign-up, invite accept | IP | 5/hr, 20 / 15min |

**The ordering discipline is already right.** Server-derived keys (workspace,
chatbot, API key) come first; caller-derived keys (IP) come last and are never
the only control. `clientIpFrom` is documented as untrustworthy and treated that
way. This is the part of the design worth preserving verbatim — the problem is
the store underneath it, not the keys above it.

### 1.2 What is missing entirely

| Capability | State |
| --- | --- |
| Distributed / shared counters | **None.** No Redis, no KV, no cache library, no shared store of any kind |
| Quotas | **None.** `usage_events` meters; nothing reads it to refuse |
| Concurrency limits | **None.** No limit on simultaneous AI turns, agent trees, workflow runs or ingestions |
| Queue / background workers | **None.** Knowledge processing and workflow runs execute inside the request |
| Plan / entitlement enforcement | **None.** `ENTITLEMENT_KEYS` exists; `organizations` has no plan column |
| `Retry-After` header on 429 | **Not sent.** The delay is prose inside `error.message` |
| Tests for any of it | **None.** No test file covers `rate-limit.ts` |
| Abuse events | **None.** `platform_audit_log` records privileged actions only |
| Request body size cap | **None in app code.** `parseJsonBody` calls `request.json()` uncapped |

### 1.3 Execution limits that DO exist and must be reused, not duplicated

This is the most important audit finding. The expensive paths are already
bounded, server-side, with clamped configuration:

- **`src/features/agents/delegation-limits.ts`** — `DELEGATION_DEFAULTS`
  (depth 2, 3 delegations, 60s, 100k tokens) and `DELEGATION_CEILINGS` that clamp
  customer-writable `jsonb` on read. The comment states the principle this whole
  project depends on: limits are "never stated to the model as instructions."
- **`ExecutionBudget`** in `agent-execution.ts` — one mutable object shared by
  the entire delegation tree, carrying an **absolute** deadline, remaining
  delegations and remaining tokens. Charged in a `finally` so a throwing
  generator still pays. Cycle detection via `agentPath`. This is a correct
  multi-agent containment design and needs extending, not replacing.
- **`MCP_LIMITS`** in `features/mcp/constants.ts` — `maxCallsPerTurn: 5`,
  `callTimeoutMs`, argument/result byte caps, `maxServersPerWorkspace: 10`
  ("until entitlements exist" — an explicit seam left for this work).
- **Workflows** — `MAX_RUN_STEPS: 40`, `MAX_NODES: 60`, `MAX_AGENT_STEPS: 5`,
  `MAX_RESPONSE_BYTES`, `MAX_REQUEST_TIMEOUT_MS`.
- **`assertWorkspaceActive()`** in `server/auth/lifecycle.ts` — fails closed, and
  is already called on **all six** expensive paths (chatbot chat, agent engine,
  knowledge pipeline, workflow executor, MCP execution ×2). **This is the
  existing chokepoint for spend, and it is where quota and concurrency belong.**

### 1.3.1 The AI catalogue (migration 0024) — landed during this audit

`src/server/db/schema/ai-registry.ts` appeared while this document was being
written, and it changes the cost design materially:

- `ai_models.input_cost_per_mtok` / `output_cost_per_mtok` and
  `embedding_models.cost_per_mtok` — `numeric(12,4)`, with the comment "these are
  multiplied by token counts to produce money."
- `ai_models.context_window` — a real ceiling for max-input enforcement.
- Platform-owned, guarded by `requirePlatformAccess`, no `workspace_id`.
- Its header notes nothing in the request path reads these tables yet.

**This is the missing half of AI cost protection.** Without it a budget can only
count tokens, which prices a cheap model and an expensive one identically. With
it, a ceiling can be denominated in money. §4.6 assumes it.

### 1.4 Identity, and why limits can be keyed safely

- `workspaceRoute` → origin check → session → membership → minimum role.
- `platformRoute` → origin check → session → `platform_admins`, 404 on refusal.
- `authenticateApiKey` derives the workspace **from the key hash**; the caller
  never names a tenant.
- Chatbot channels resolve the workspace from a stored row via embed key or id.

Every rate-limit key the product needs is therefore derivable from server-side
state that no client header can influence. `X-User-Id`-style spoofing is already
structurally impossible — nothing reads a tenant identifier from a request.

---

## 2. The root cause

```text
Instance A ──▶ Map { "public-api:workspace:X" → 412 }
Instance B ──▶ Map { "public-api:workspace:X" → 388 }   ← neither knows about the other
Instance C ──▶ Map { "public-api:workspace:X" → 401 }
```

A documented 600/min ceiling is 1,800/min across three instances. Worse, the
process-local `Map` is the **only** thing standing between a public widget and
AI provider spend, because there is no quota layer behind it.

`docs/security.md` already lists this honestly under Known gaps. This document
exists to close it.

---

## 3. The infrastructure decision gate — **BLOCKED, needs approval**

A distributed limit needs a shared authoritative store, and this repository has
none. Choosing one is a new infrastructure dependency, so per the brief:
**stopping here.**

The choice is also entangled with an unresolved deployment question.

### 3.1 The deployment contradiction

`docs/deployment.md` states, in bold: *"This decision has been taken. The target
is Cloudflare Workers"* — and commit `d30e5ff` removed egress socket pinning to
suit it. But the code as written cannot run there:

| Fact in the code | Consequence on Workers |
| --- | --- |
| `pg.Pool`, `max: 10`, in `db/client.ts` | Needs Hyperdrive. Not configured; `pg` is a direct dependency |
| `withWorkspace()` holds one connection for `set_config('app.workspace_id')` | RLS depends on connection affinity, which per-isolate pooling is not |
| `node:crypto` scrypt password hashing | Workable, but CPU-bounded per isolate |

So the repository currently targets a runtime it is not able to deploy to. **I am
not treating either doc as settled**, because the answer changes the recommended
substrate entirely — and it is your call, not mine.

### 3.2 Options

| | Option | New dependency | Distributed | Quotas | Concurrency | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | Cloudflare Rate Limiting rules (zone/WAF) | None in the app | Yes | No | No | Crude volumetric protection per IP/path. Cannot see workspace or API-key identity without Enterprise-tier advanced rules. Solves floods, solves nothing about AI cost |
| **B** | **PostgreSQL-backed limiter** | **None** | Yes | **Yes** | **Yes** | Atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`. Uses the pool that already exists. One indexed upsert per limited request — proportionate, given `assertWorkspaceActive` already queries on every AI turn. Hot-key contention on a per-workspace row is the real risk, at volumes far above today's |
| **C** | Redis / Upstash | **Yes — a second distributed state system** | Yes | Yes | Yes | The textbook answer. Sub-ms, atomic Lua, sliding windows. Upstash's REST client also works on Workers. Costs a new service, new failure mode, new secret, new fail-open/closed policy |
| **D** | Cloudflare Durable Objects | Yes (and Workers) | Yes | Yes | **Best** | Strongly consistent single-threaded counters — ideal for concurrency leases. Only available if the Workers deployment actually happens, and it puts limits in a different runtime from the app |
| **E** | Workers Rate Limiting binding | Yes (and Workers) | Per-colo only | No | No | Simple, but not globally consistent and no quota concept |

### 3.3 Recommendation

**A (edge) + B (Postgres), and explicitly not C.**

The reasoning is that these three problems have different shapes and one
substrate is the wrong answer for all of them:

- **Quotas are durable accounting.** They must survive a restart, be auditable,
  and reconcile against `usage_events` — which is already a Postgres table. Redis
  is the wrong home for a number a customer may be billed on.
- **Concurrency is a lease.** A row with an expiry, taken and released in the
  transaction that already exists around the work, is correct and crash-safe.
- **Rate limits are the only part that genuinely wants Redis**, and they are also
  the part an edge limiter (A) can absorb the volumetric half of. What remains —
  identity-keyed ceilings at tens of requests per second — is comfortably within
  Postgres.

This keeps the brief's rule "do not introduce a second distributed state system
without justification" intact. If measured traffic later shows the limiter upsert
is a bottleneck, C becomes justified **on evidence**, and the abstraction in
Phase 1 is designed so it swaps behind one interface.

> ### ⛔ Approval needed before any implementation
>
> 1. **Deployment target** — Cloudflare Workers (per `docs/deployment.md`), or a
>    Node host? If Workers, Hyperdrive + the `pg.Pool`/RLS question must be
>    resolved first, and D becomes the better concurrency substrate.
> 2. **Substrate** — approve **A + B (Postgres, no new dependency)**, or direct
>    me to C (Redis/Upstash — name the provider, it is a new service and secret).
> 3. **Is a Cloudflare zone in front of the app today?** I could not verify this
>    from the repository. If yes, layer A is configuration and I will document
>    rather than build it. If no, the app layer must carry the whole load.
> 4. **How many instances run in production today?** If the answer is one, this
>    is pre-emptive hardening rather than an active hole, which changes the
>    urgency but not the design.

---

## 4. Design, assuming the recommendation is approved

### 4.1 Enforcement layers

```text
Internet
   │
   ▼ Cloudflare rate limiting rules ────────── volumetric, IP/path, no identity
   │
   ▼ proxy.ts ──────────────────────────────── NOT a limiter. See §4.2
   │
   ▼ Route guard  (workspaceRoute / platformRoute / authenticateApiKey)
   │     └─ identity resolved server-side
   │
   ▼ protect()  ── the new capability ───────  rate · quota · concurrency
   │     ├─ in-process pre-filter   (reject-only, never allows)
   │     └─ Postgres authority      (atomic upsert / lease)
   │
   ▼ assertWorkspaceActive()  ← existing chokepoint, extended
   │
   ▼ ExecutionBudget / MCP_LIMITS / MAX_RUN_STEPS  ← existing, extended
   │
   ▼ AI gateway
```

### 4.2 Why the limiter does not go in `proxy.ts`

Verified in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`:
Next 16 renamed middleware to proxy and it defaults to the Node runtime — but the
docs state it "is meant to be invoked separately of your render code and in
optimized cases deployed to your CDN" and that you "should not attempt relying on
shared modules or globals."

A limiter there would be both unreliable and blind to identity, which is resolved
downstream. `proxy.ts` stays exactly as it is.

**Separately worth flagging:** because `proxy.ts` exists and its matcher covers
`/api`, Next buffers every API request body in memory up to
`proxyClientMaxBodySize` (default **10MB**). Over that limit the body is silently
**truncated rather than rejected** — the request proceeds with partial data. With
`parseJsonBody` reading uncapped, that is the request-size gap in §1.2.

### 4.3 The four layers, kept separate

| Layer | Question | Store | Window |
| --- | --- | --- | --- |
| Rate limit | "too often?" | Postgres bucket row | seconds–minutes |
| Quota | "too much this month?" | `usage_events` + cached aggregate | billing period |
| Concurrency | "too many at once?" | Postgres lease row | lifetime of the work |
| Abuse | "a pattern worth acting on?" | new `security_events` table | rolling |

### 4.4 Key strategy

Keys are built **only** from server-derived identity — never a request header,
never a body field. A typed builder, so a key cannot be assembled by string
concatenation at a call site:

```text
{ scope: "public-api", dimension: "workspace", id: <resolved workspace id> }
```

IP-derived keys stay marked as best-effort and may only ever be the *narrowest*
limit in a stack, never the only one — the discipline already in the code.

### 4.5 Quotas

Resolved through `ENTITLEMENT_KEYS`, which already names the four metered keys
(`messagesPerMonth`, `tokensPerMonth`, `workflowRunsPerMonth`, plus counts) and
already lines up with `usage_events.kind`. Enforcement reads a cached
period aggregate, not a live `sum()` per request.

**No plan checks scattered in feature code.** One resolver:
platform default → plan → organization override → workspace override.
`organizations` needs a plan column; `PLANS` is still `status: "draft"` with
`undecided` limits, so quotas ship **disabled by default** and become active per
tier only once pricing is decided.

### 4.6 AI cost protection

The brief's central point, and the one the existing code is closest to. Extends
`ExecutionBudget` rather than adding a parallel system:

- Max input / output / total tokens per request — clamped server-side, layered on
  `DEFAULT_MODEL_CONFIG.maxTokens` and bounded by `ai_models.context_window`.
- Tree-wide token budget, delegation count, depth, absolute deadline — **exists**.
- `maxCallsPerTurn` for MCP — **exists**.
- New: a workspace-level **spend ceiling** consulted in `assertWorkspaceActive`'s
  caller path, so a runaway agent stops even when every per-request limit passes.
- Retrieval size caps on RAG.

**Denominate the ceiling in money, not tokens.** With §1.3.1 landed, a budget can
be priced: `tokens × ai_models.*_cost_per_mtok`. A 100,000-token tree budget is a
very different bill on a cheap model than on a frontier one, and a token-only
ceiling silently lets a model switch multiply spend. The `ExecutionBudget` gains a
cost field alongside `remainingTokens`; token limits stay as the cheap guard that
works when a model has no price recorded.

Two consequences worth surfacing at approval time: pricing rows are
operator-maintained and **wrong prices become wrong ceilings**, and a model with
`NULL` pricing must be decided — refuse, or fall back to the token budget. I
recommend the fallback, so an unpriced model degrades to today's behaviour rather
than becoming unusable.

### 4.7 Concurrency

A lease row per `(workspace, resource)` with an expiry, taken before the work and
released in a `finally` — the same shape as the existing `deadlineSignal`
cleanup. **Reject, do not queue:** there is no queue infrastructure, and the brief
is explicit that silently queueing without one is not acceptable. Expired leases
are reclaimed on acquisition, so a crashed process cannot deadlock a workspace.

### 4.8 Per-surface protection

| Surface | Additions |
| --- | --- |
| Auth | Existing email+IP limits become authoritative; add lockout backoff and `AUTH_FAILURE_THRESHOLD` events |
| Public API | Keys become binding; add `Retry-After`; per-key concurrency |
| Public chatbot | Keep the three-tier stack; add session dimension, message-size and context caps, workspace quota |
| API keys | Per-key rate + concurrency; revocation already immediate via `revokedAt`; keys identified in events by **prefix/fingerprint only** |
| Agents | Budget extended with a workspace-level ceiling; parallel-branch cap |
| Workflows | Reuse `MAX_RUN_STEPS`; add runs-per-period quota and concurrent-run limit |
| MCP | Per-workspace and per-agent call limits **layered on top of** — never instead of — grants, approvals, egress guard and tenant isolation |

### 4.9 Super Admin

Extends the existing control plane (`platformRoute`, `platform_audit_log`,
`/admin`). A new **Abuse & Protection** section: policies, quotas, concurrency,
security events, temporary blocks. Every mutation audited through
`recordPlatformAudit`, which already redacts. **Phase 6 — last, deliberately.**
Policy configuration and visibility only; no ML detection.

### 4.10 Fail-open vs fail-closed

Per category, not globally:

| Category | On limiter failure | Why |
| --- | --- | --- |
| Authentication | **Closed** | A brute-force window opened by a database blip is the worst case |
| AI / agent / workflow / MCP spend | **Closed** | Matches `assertWorkspaceActive`, which already fails closed on exactly these paths |
| Public chatbot | **Closed**, generic 503 | Same non-disclosure rule already in `lifecycle.ts` |
| Read-only dashboard APIs | **Open**, logged | Already behind session + membership; refusing them turns a limiter outage into an outage |

Note that fail-closed on the Postgres substrate is nearly free: if Postgres is
down, those paths cannot run anyway.

### 4.11 Error semantics

`ApiErrorCode` already has `rate_limited` (429) and `unavailable` (503). Needs
distinct codes for `quota_exceeded`, `concurrency_limit`, `suspended` and
`not_entitled` — 429 for the first two (`Retry-After` where meaningful), 403 for
the rest. Messages say what to do; never a counter, a key, a limit internal, or
which tenant consumed what.

### 4.12 Observability and privacy

Metadata only — timestamp, scope, workspace, key **fingerprint**, limit
triggered, result. Never prompts, messages, payloads or credentials. This follows
the rule `platform-isolation.test.ts` already enforces on operator reads.

---

## 5. Breaking changes — flagged, not taken

1. **Published ceilings become binding.** `docs/api/rate-limits` documents 600/600/300/120/30 per minute, with a note that a multi-instance deployment multiplies them. Making them authoritative is a **reduction in effective allowance** for any customer currently benefiting from that multiplication. Customer-visible; needs a decision on whether to raise the published numbers at the same time.
2. **`Retry-After` on 429** — additive, safe, but a change to the documented API contract.
3. **New `ApiErrorCode` values** — additive; clients branch on `code`, and unknown codes already degrade through `codeFromStatus`.
4. **`organizations` gains a plan column** — additive, defaulted, no behaviour change until quotas are enabled.
5. **Quotas, once enabled, can refuse work that previously succeeded.** Ship disabled; enable per tier deliberately.

None of these are being made without a second approval.

---

## 6. Implementation phases

| Phase | Scope | Gate |
| --- | --- | --- |
| 1 | `protect()` abstraction, policy/quota/concurrency models, Postgres substrate, in-process pre-filter retained, `Retry-After`, tests | Needs §3 approval |
| 2 | Auth, API keys, public/developer API | |
| 3 | AI: chat, agents, embeddings, RAG, workflows, multi-agent — token/cost/concurrency | |
| 4 | Public chatbot | |
| 5 | MCP limits, preserving every existing control | |
| 6 | Super Admin policies, events, visibility, blocks | |

Tests are written **with** each phase, not after: distributed behaviour, race
conditions on concurrent requests, tenant isolation of quotas, key-spoofing
resistance, revoked-key rejection, fail-open/closed behaviour per category, and
no-secrets-in-logs.

---

## 7. Unresolved, needing your decision

1. §3 — deployment target, substrate, Cloudflare zone, instance count. **Blocking.**
2. Do the published ceilings stay at their current numbers when they become real?
3. Should quotas ship inert (recommended, since `PLANS` is undecided) or with provisional free-tier numbers?
4. Knowledge processing and workflow runs execute **inside the request**. Concurrency limits will make this visible as refusals under load. A queue is the real fix and is out of scope here — confirm that deferring it is acceptable.
5. Cost ceilings: what happens to a model with `NULL` pricing in `ai_models`? Recommendation is to fall back to the token budget rather than refuse.

---

## 8. Baseline

`pnpm vitest run` at the time of writing, before any change:

```text
Test Files  98 passed | 15 skipped (113)
     Tests  1270 passed | 117 skipped (1387)
```

The 15 skipped files are the `*.integration.test.ts` suites, which need a live
database. Nothing in this work may lower either number.

Note that migration 0024 (`ai-registry`) landed in the working tree during this
audit and is uncommitted, alongside a large set of pre-existing uncommitted
changes. This document describes the tree as it stands, not as it is committed.

---

## 9. Decisions as taken

Answered at the gate:

| Question | Decision |
| --- | --- |
| Deployment target | **Cloudflare Workers**, as `docs/deployment.md` states |
| Substrate | **Cloudflare rate-limiting rules at the edge + PostgreSQL in the app.** No new dependency |
| Cloudflare zone in front today | **Yes.** Layer A is configuration to document, not code to build |
| Published ceilings | **Raise them** when they become authoritative, so no working integration breaks. New numbers proposed for approval at Phase 2 |

### 9.1 The tension this creates, stated plainly

Workers + PostgreSQL means **Hyperdrive is now a precondition**, and it is not
configured. `docs/deployment.md` already says so for `pg`. Two things follow:

1. **This is not a new risk introduced by this work.** It is the existing,
   already-recorded deployment gap, and it blocks the *entire application* on
   Workers, not just the limiter.
2. **The limiter is the part least exposed to it.** Every protection query runs
   on a plain pooled connection with no transaction and no
   `set_config('app.workspace_id')`, so it does not depend on the connection
   affinity that `withWorkspace()` needs and that Hyperdrive's pooling puts in
   question. The limiter will work under Hyperdrive whether or not the RLS
   transaction question is resolved.

**Unverified, and it must be verified before a Workers deployment:** whether
Hyperdrive preserves the connection affinity `withWorkspace()` requires for
`set_config(..., true)` to be visible to later statements in the same
transaction. I could not test this from the repository. If it does not hold, RLS
silently stops applying — which is a far larger problem than rate limiting, and
is the reason it is called out here rather than left in a deployment doc.

### 9.2 What the edge layer now owns

With a zone confirmed in front, the split is:

| Layer | Owns | Built how |
| --- | --- | --- |
| Cloudflare rules | Volumetric floods, per-IP/path, bot traffic, gross request-size rejection | Configuration, documented at Phase 2 |
| Application | Everything keyed on identity the edge cannot see: workspace, API key, chatbot, account, agent, quota, concurrency, cost | This codebase |

That split is what keeps a Postgres substrate viable: the edge absorbs the
high-cardinality volumetric half, and the app handles identity-keyed ceilings at
rates measured in tens per second, on paths that already query the database.

### 9.3 Still open (not blocking Phase 1)

Items 2–5 of §7 remain undecided and are due at the phase that needs them:
published ceiling values (Phase 2), quota activation and `NULL` model pricing
(Phase 3), and the in-request execution / queue question (Phase 3–4).

---

## 10. Outcome — Phase 1, implemented

The foundation only. **No existing call site changed and no request behaves
differently**: the in-process limiter still runs every current limit, and the new
substrate is consulted by nothing until phases 2-5 wire each surface. That was
deliberate - a protection layer that lands wired is a protection layer whose
first production incident is also its first test.

### What was added

| File | Role |
| --- | --- |
| `src/server/db/migrations/0025_protection.sql` | `rate_limit_buckets`, `concurrency_leases` |
| `src/server/db/schema/protection.ts` | Drizzle description of both |
| `src/server/protection/keys.ts` | Key model, trust classification, window alignment |
| `src/server/protection/store.ts` | `ProtectionStore` interface + PostgreSQL implementation |
| `src/server/protection/protect.ts` | `protect()`, `withConcurrencyLease()`, error mapping |

Changed: `ApiError` gained four codes and `retryAfterSeconds`; `fail()` emits
`Retry-After`.

### The three decisions worth re-reading later

**1. The pre-filter may reject, and may never allow.** Both layers key on the
same absolute-aligned window, so the local count for a window can never exceed
the global count for it - a local rejection is therefore one the authority would
also make, and can be taken without asking. The converse is false, so an allow
always costs a round trip. The payoff is that a flood costs a `Map` lookup rather
than a database write per request, which matters because an abuse control that
gets expensive under abuse is not much of a control.

**2. Ordering is enforced, not documented.** `checkRateLimits` already said to
put server-derived ceilings first; `protect()` now throws if a caller-derived
limit is placed in front of one, or if a stack has no server-derived dimension at
all. Both were true of every existing call site already - the point is that the
twelfth one cannot quietly be the exception.

**3. Concurrency is slots, not a counter.** Count-then-insert is wrong under READ
COMMITTED. `UNIQUE (scope_key, slot)` makes over-allocation unrepresentable
instead, and a bounded retry recovers the capacity that the resulting collisions
would otherwise waste.

### Verified, and how

Against **PostgreSQL 17.11** in a throwaway database (created, migrated,
exercised, dropped):

| Claim | Evidence |
| --- | --- |
| The DDL is valid | Migration applied cleanly; both tables created |
| No increment is lost when requests interleave | 50 concurrent `consume` calls produced counts 1..50 exactly, with exactly the ceiling allowed |
| Instances share one counter | Three direct store calls, no pre-filter between them, refused at the ceiling |
| A concurrency limit cannot be raced past | 30 concurrent acquisitions against 4 slots granted at most 4, every run |
| A crashed holder's slot returns | Expired lease reclaimed, with a new `lease_id` so a late release cannot delete its replacement |
| The retry is worth having | 20 callers / 20 slots: 25% of capacity filled without it, 80% with; over-allocation never observed at either setting |

Suite: **1313 passed, 130 skipped, 0 failed** (baseline was 1270/117/0 — 43 new
tests, 13 of which skip without a database). `pnpm typecheck` and `pnpm lint`
clean. `pnpm build` succeeds.

### Two things NOT verified, stated plainly

1. **Migration 0025 has not been applied to the project's own dev database** - it
   was not running (`ECONNREFUSED 127.0.0.1:54322`). The DDL was proven against a
   separate PostgreSQL 17 instance. `pnpm db:migrate` still has to be run, and
   `tests/unit/schema-drift.integration.test.ts` should be run after it to
   confirm the Drizzle description and the live table agree.
2. **`pnpm build` fails without `APP_SECRET`** in the environment
   (`/robots.txt` prerender). Pre-existing and unrelated to this work; the build
   was verified by supplying a throwaway value.
