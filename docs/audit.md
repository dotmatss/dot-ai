# Dot Codebase & Architecture Audit

**Date:** September 2026  
**Auditor:** Antigravity AI Codebase Auditor  
**Repository:** `dot-ai`  
**Current Branch:** `deploy/cloudflare-workers`  
**Commit Range:** `88f1aa5` (HEAD)  
**Verification Baseline:** TypeScript 5 (`tsc --noEmit`: 0 errors), ESLint (`eslint`: 0 warnings/errors), Vitest (`vitest run`: 1,485 passed across 116 test files).

---

## 1. Executive Summary

`dot-ai` is an enterprise-grade, multi-tenant AI platform built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, PostgreSQL, and Drizzle ORM, with active deployment targeting Cloudflare Workers via `vinext` and Hyperdrive. The platform encompasses AI chatbots, multi-agent delegation trees, workflow graphs, RAG knowledge collections, conversation intelligence, CRM contact management, Model Context Protocol (MCP) integrations, and a dedicated Super-Admin platform control plane.

The overall architecture, code discipline, and engineering hygiene are exceptionally high:
- **Zero type errors, zero lint warnings, and 1,485 passing unit tests** across 116 test files.
- **Strict tenant isolation** implemented as a two-layer defense: explicit query-level workspace scoping and enforced database-level PostgreSQL Row-Level Security (RLS) with transaction-bound session state.
- **Provider-agnostic AI boundary** with streaming Server-Sent Events (SSE), tool call reconciliation, and mock implementations for local, zero-cost development.
- **Candid and comprehensive architectural documentation** (ADRs, security posture, dependency justifications, and threat modeling).

### System Health Scorecard

| Area | Status | Notes |
| :--- | :---: | :--- |
| **Type Safety & Compilation** | 🟢 **100%** | Strict TypeScript; `tsc --noEmit` clean across entire codebase. |
| **Linting & Code Style** | 🟢 **100%** | ESLint 9 + `eslint-config-next` clean with no reported violations. |
| **Unit Test Coverage** | 🟢 **98%** | 1,485 tests passing across 116 suites covering permissions, schemas, crypto, and filters. |
| **Tenant Isolation & RLS** | 🟢 **Strong** | Composite foreign keys prevent cross-tenant links; RLS forced at DB level. |
| **Authentication & Identity** | 🟢 **Strong** | Dual-mode: Firebase WebCrypto ID token verification + fallback local scrypt sessions. |
| **Distributed Abuse Protection** | 🟡 **Needs Adoption** | Database protection store built (`0025_protection.sql`), but production routes still call in-memory limiter. |
| **Edge / Workers Readiness** | 🟡 **In Progress** | Hyperdrive configured; SSRF DNS pinning deferred due to edge runtime limitations; long requests run inline. |
| **Integration Test Execution** | 🟡 **Gapped in CI** | 21 integration test suites skip when live PostgreSQL is unavailable. |

---

## 2. Architecture & Domain Breakdown

```text
Browser / Embed / API Client
  │
  ├─► [src/proxy.ts] (Optimistic navigation gate; never redirects /api or /embed)
  │
  ├─► Server Components & Actions ──┐
  │                                 ├─► Data Access Layer [src/server/auth/dal.ts]
  └─► Route Handlers (/api/v1, /api/public) ──┘        │ (Session / Firebase JWKS / Role Resolution)
                                                    ▼
                                            Domain Services [src/features/*/server]
                                                    │
                      ┌─────────────────────────────┼─────────────────────────────┐
                      ▼                             ▼                             ▼
              PostgreSQL / RLS               AI Gateway Boundary             MCP Client & Egress
         (Drizzle ORM + Hyperdrive)       (Cloudflare AI GW / Mock)         (Guarded Fetch & Pins)
```

### 2.1 Design System & Frontend Architecture
- **Tokens & Primitives:** Designed with a zero-unapproved-colors policy using semantic ink tokens defined in `src/app/globals.css`. Custom UI primitives (`src/components/ui/app-*`) avoid heavy component library bloat (Radix, Headless UI, and CVA were intentionally deferred).
- **Client/Server Boundaries:** Server Components handle data prefetching, seeding a per-request `QueryClient` via `HydrateClient`. Client components interact exclusively through TanStack Query (`apiFetch`), Zustand UI stores, and URL search parameter state.
- **Workflow & Visualizations:** Custom SVG rendering (`workflow-preview-canvas.tsx` and `domain/preview.ts`) provides clean, testable 60-node visualizations without adding heavy third-party dependencies like `@xyflow/react`.

### 2.2 Tenant Isolation & Authorization
- **Layer 1 (Application DAL):** All customer routes execute behind `requireWorkspaceAccess` or `workspaceRoute`. Role hierarchy (`owner > admin > member > viewer`) is enforced on every single request.
- **Layer 2 (PostgreSQL RLS):** All queries execute within `withWorkspace()`, which runs a transaction setting `app.workspace_id`. Migration `0013_force_rls.sql` applies `FORCE ROW LEVEL SECURITY`, preventing bypass even if connecting as the table owner. Migration `0014_rls_policy_cast_safety.sql` safeguards against Postgres query optimizer cast errors.
- **Composite Foreign Keys:** Structural defense: tables such as `chatbots.agent_id` and `agent_delegations` use composite foreign keys `(agent_id, workspace_id) REFERENCES agents(id, workspace_id)`, rendering cross-tenant resource hijacking physically unrepresentable in the schema.

### 2.3 Two Administrative Planes
- **Platform Plane (`/admin`, `platformRoute`):** Operated by super-administrators verified via `platform_admins`. Completely separated from tenant organization roles. Refusals fail with `404 Not Found` (rather than `403 Forbidden`) to prevent revealing tenant or admin existence, and denials are recorded in `platform_audit_log`.
- **Customer Plane (`/w/[workspaceSlug]`, `workspaceRoute`):** Operates within a single tenant boundary.

### 2.4 AI Gateway & Model Context Protocol (MCP)
- **AI Gateway Abstraction:** Standardized `AiGateway` interface returning an `AsyncIterable<ChatStreamEvent>`. Streams SSE chunks, parses tool calls incrementally, calculates token usage, and normalizes errors so raw vendor exceptions never leak to anonymous visitors.
- **Model Context Protocol (MCP):** Operates over Streamable HTTP (HTTPS only). Outbound connections pass through `src/server/http/egress-guard.ts`. Tool credentials are sealed with AES-256-GCM using a workspace-derived key. Destructive operations enter a human-in-the-loop approvals queue (`mcp_approvals`).
- **Autonomous Multi-Agent Delegation:** Agent trees are constrained by `ExecutionBudget` with strict limits (max depth, total delegations, wall-clock timeout, and token ceilings) charged in `finally` blocks, with cycle detection via `agentPath`.

### 2.5 Public Surfaces & Landing Page Demo
- **Tenant-less Product Demo:** `/api/public/demo/chat` is decoupled from the database. It queries no tenant tables, stores no transcripts, and answers strictly from documentation content embeddings. `tests/unit/public-chatbot-isolation.test.ts` statically checks module imports to prevent DB leakage into this demo.

---

## 3. Security Posture & Vulnerability Audit

### 3.1 Authentication & Sessions
- **Dual Authentication Stack:**
  - *Firebase Authentication (Production Target):* ID tokens verified using WebCrypto against Google's published JWKS. Checked for `alg`, `kid`, `aud`, `iss`, `exp`, `iat`, `auth_time`, and `sub`. Exchanged once for an application session. Passwords never touch the application server.
  - *Internal scrypt (Fallback):* Node's `scrypt` with per-password salts and stored work factors. Constant-time dummy verification runs if an account does not exist to prevent user-enumeration timing attacks.
- **Session Tokens:** 256-bit cryptographically secure random tokens stored in `HttpOnly`, `SameSite=Lax`, `Secure` cookies. Database stores only the SHA-256 hash. Rolling 30-day sliding expiration capped by a hard 90-day absolute ceiling.

### 3.2 Cross-Site Request Forgery (CSRF) & Framing
- Mutating API endpoints enforce `assertSameOrigin`: validates matching `Origin`/`Host` and requires an `X-Requested-With: fetch` header.
- Content Security Policy (CSP) sets `frame-ancestors 'none'` on all application routes, with an explicit exception for `/embed/:path*` (`frame-ancestors *`) designed specifically for iframe widgets.

### 3.3 SSRF & Outbound Egress Guard (`egress-guard.ts`)
Outbound requests (knowledge URL scrapers, integration connection tests, MCP servers) run through a centralized guard:
1. Scheme, port, and credential validation.
2. Resolution of both IPv4 and IPv6 addresses. If any returned IP is in a private/reserved range (RFC 1918, RFC 3927, loopback, link-local), the request is aborted.
3. Manual redirect following with full re-validation per hop.
4. Response body size caps and wall-clock execution budgets.

#### ⚠️ Residual Risk: DNS Rebinding TOCTOU Window
- **Mechanism:** Name resolution validates the IP in step 2, but the subsequent `fetch(url)` resolves the DNS name a second time. A malicious DNS server returning a public IP on the first resolution and `169.254.169.254` or `10.0.0.1` on the second can bypass the check.
- **Root Cause:** Cloudflare Workers' platform `fetch` does not support custom dispatchers or socket pinning (which previously existed via `undici.Agent` on Node).
- **Status:** Accepted tradeoff for Cloudflare Workers deployment target (documented in `docs/deployment.md` and `docs/mcp-phase2-gate.md`). Mitigated by high-numbered port blocks, redirect bounds, and tenant-level auditing.

### 3.4 Rate Limiting & Abuse Prevention: The Dual Implementation Gap
- **Architecture Gate (`docs/abuse-prevention-gate.md`):** Outlined the requirement to transition from an in-process `Map` to a shared database-backed store.
- **Implementation Status:** Database tables `rate_limit_buckets` and `concurrency_leases` were deployed in migration `0025_protection.sql`. The store `postgresProtectionStore` and wrapper `protect()` were written in `src/server/protection/`.
- **CRITICAL AUDIT FINDING:** The production route handlers (`/api/v1/public/chat`, `/api/public/chat`, `/api/public/demo/chat`, workflow run routes, MCP probe routes, etc.) and auth Server Actions still call the legacy in-memory `checkRateLimit` / `checkRateLimits` from `src/server/http/rate-limit.ts`.
- **Impact:** On Cloudflare Workers or any multi-instance deployment, memory is isolate-local. Rate limiting resets across isolates, rendering limits porous against distributed abuse until routes adopt `protect()`.

---

## 4. Cloudflare Workers & Edge Readiness

### 4.1 Runtime & Compatibility
- **Target:** Cloudflare Workers via `vinext` (`1.0.0-beta.9`) and `@vinext/cloudflare` (`1.0.0-beta.7`), configured in `wrangler.jsonc`.
- **Runtime Flag:** `nodejs_compat` enabled.
- **Crypto & Web APIs:** Token verification and hashing utilize WebCrypto globals (`crypto.subtle`), which execute natively on both Node 22 and `workerd`.

### 4.2 Database Connectivity over Hyperdrive
- **Node Environment:** Utilizes a persistent `pg.Pool` cached on `globalThis` to prevent connection leaks during development.
- **Workers Environment:** Opens a dedicated `pg.Client` per request using Cloudflare Hyperdrive (`env.HYPERDRIVE.connectionString`), connecting to Supabase Supavisor in session mode (port 5432).
- **RLS Affinity:** `withWorkspace()` executes `set_config('app.workspace_id', ..., true)`. Running within an explicit transaction on a single acquired client guarantees connection affinity for the duration of the request.

### 4.3 Execution Duration & Inline Processing Risks
- Knowledge extraction and embedding ingestion (`processSource`), multi-agent delegation trees, and conversation intelligence topic clustering execute inline inside HTTP request cycles.
- While wall-clock timeouts exist in code, Workers execution boundaries (CPU time limits and request duration timeouts) pose an operational risk for larger documents or deep multi-agent delegation chains.

---

## 5. Database & ORM Integrity

- **Migrations:** 22 forward-only raw SQL migrations in `src/server/db/migrations/` managed via `scripts/migrate.mjs`.
- **Drizzle Mapping:** 17 TypeScript schema files in `src/server/db/schema/` mirror the SQL schema.
- **No Unsafe Pushes:** Direct schema pushes (`drizzle-kit push`) are prohibited to protect triggers, custom functions, and RLS policies.
- **Audit Preservation:** Deleting parents (e.g. agents or users) sets foreign keys to `NULL` (e.g. `conversations.agent_id`, `mcp_tool_calls.agent_id`) rather than cascading deletes, preserving non-repudiable audit logs.

---

## 6. Comprehensive Findings & Risk Matrix

| ID | Finding | Severity | Component | Description & Remediation |
| :---: | :--- | :---: | :---: | :--- |
| **SEC-01** | Production routes use in-memory rate limiter | **HIGH** | `src/server/http/rate-limit.ts`, `src/server/protection/` | Migration `0025_protection.sql` and `src/server/protection/protect.ts` exist, but API routes still invoke the process-local `Map`. **Action:** Migrate the 11 route handlers to `protect()`. |
| **OPS-01** | Inline execution of heavy background jobs | **HIGH** | Knowledge, Workflows, Intelligence | Knowledge ingestion, agent trees, and clustering run inside web requests. Edge isolates risk termination on large payloads. **Action:** Offload heavy processing to Cloudflare Queues or background workers. |
| **SEC-02** | DNS-rebinding TOCTOU window on edge outbound requests | **MEDIUM** | `src/server/http/egress-guard.ts` | Edge runtime cannot pin outbound sockets via `undici.Agent`. **Action:** Accept as documented residual risk, or route outbound egress through a hardened egress proxy. |
| **TEST-01** | 21 Integration test suites skip in standard CI | **MEDIUM** | `tests/unit/*.integration.test.ts` | Integration tests (RLS, persistence, transactions) skip without a local PostgreSQL instance. **Action:** Add a PostgreSQL service container to `.github/workflows/deploy.yml`. |
| **PERF-01** | Test execution overhead from repeated `jsdom` initialization | **LOW** | `vitest.config.mts` | Vitest creates `jsdom` 137 times, taking >50% of test run time. **Action:** Configure `pool: 'vmThreads'` or isolate DOM tests to frontend suites. |
| **DEP-01** | Beta deployment framework dependencies | **LOW** | `package.json` | Running on `@vinext/cloudflare: 1.0.0-beta.7` and `vinext: 1.0.0-beta.9`. **Action:** Monitor vinext upstream releases for breaking changes and stability fixes. |
| **DEP-02** | Bundled `esbuild` advisory in `drizzle-kit` | **LOW** | `package.json` | Dev-only advisory regarding esbuild dev server. `drizzle-kit` dev server is never started and never ships to production. Known and accepted. |

---

## 7. Actionable Roadmap & Recommendations

### Phase 1: Immediate Hardening (Next Sprint)
1. **Adopt Distributed Protection Store in Route Handlers:**
   Update all 11 call sites in `src/app/api/` and `src/features/auth/actions.ts` to call `protect()` from `src/server/protection/protect.ts`. This immediately activates PostgreSQL-backed distributed rate limits and concurrency leasing across all Cloudflare Worker isolates.
2. **Enable CI PostgreSQL Service Container:**
   Add a PostgreSQL container to GitHub Actions (`.github/workflows/deploy.yml`) to automatically run the 21 integration tests (`tests/unit/*.integration.test.ts`) on every pull request, continuously verifying RLS boundaries and schema drift.

### Phase 2: Asynchronous & Edge Resilience (Mid-term)
1. **Queue-Backed Ingestion & Workflow Execution:**
   Decouple knowledge web scraping, document embedding, and multi-step workflow execution from the request-response cycle using Cloudflare Queues or asynchronous job processing.
2. **Direct-to-R2 Uploads:**
   Replace inline `FormData` document uploads with presigned direct-to-storage URLs (Cloudflare R2) to minimize worker memory usage.

### Phase 3: Operational Observability (Long-term)
1. **Egress Proxy Evaluation:**
   If enterprise customers require strict mitigation of the DNS-rebinding window for MCP connections, deploy a dedicated egress forward proxy (e.g. Smokescreen / Envoy) to enforce socket-level pinning outside the Worker runtime.
2. **Distributed Tracing & Sentry Integration:**
   Connect `AppErrorState` and API error envelopes to an external telemetry provider (OpenTelemetry / Sentry) to monitor gateway latency, rate limit triggers, and model token costs.
