# Platform control plane

The application has **two administrative boundaries**, and keeping them apart is the point of this document.

```text
Platform plane                          Customer plane
requirePlatformAccess()                 requireWorkspaceAccess(slug, role)
platform_admins                         organization_members.role
/admin, /api/admin                      /w/[slug], /api/v1/w/[slug]
operates the SaaS                       operates one tenant
```

An Organization Admin manages *their* organization. A platform admin operates *the platform*. These are not two points on one scale: there is no role value, no flag and no combination of memberships that promotes a customer into the platform plane, because the platform guard never reads `organization_members` at all.

## Authorization

`src/server/auth/platform-dal.ts` is the only place a platform grant is resolved.

| Surface | Guard | Unauthenticated | Authenticated, no grant |
| --- | --- | --- | --- |
| Pages under `/admin` | `requirePlatformAccess()` | redirect to `/sign-in` | **404** |
| Routes under `/api/admin` | `platformRoute(handler)` | 401 | **404** |

**A missing grant is 404, never 403.** A 403 confirms to a customer that `/admin` exists and that one flag stands between them and it; a 404 tells them nothing. This is the same rule the agent routes already use for cross-workspace access.

`platformRoute` has **no `minimumRole` option**, deliberately. Inside the platform plane there is one privilege level, so there is no weaker setting a handler can be given by mistake.

`tests/unit/platform-authorization.test.ts` asserts the guard's behaviour, and `tests/unit/platform-isolation.test.ts` asserts that no customer route imports the platform guard and no non-platform module imports the cross-tenant repository.

### Granting access

Grants are made **out of band only**. There is no route, Server Action or service that writes to `platform_admins`, so the boundary cannot be widened by an HTTP request — not even by someone who already holds it.

Two scripts, because "who exists" and "who may operate the platform" are two decisions:

```sh
# Create a dedicated operator identity and grant it, in one transaction.
node scripts/create-platform-operator.mjs ops@example.com "Jane Ops" "Initial platform operator"

# Grant or revoke the boundary on an account that already exists.
node scripts/grant-platform-admin.mjs ops@example.com "Second operator"
node scripts/grant-platform-admin.mjs ops@example.com "Left the team" --revoke
```

`grant-platform-admin.mjs` requires a reason, refuses to grant to a disabled account, records the change in `platform_audit_log` in the same transaction, and **never creates accounts** — keeping it unable to invent a principal is the point of the split. Revocation is a timestamp, not a delete, so "who used to hold this" stays answerable.

### The operator account

Use an identity that operates the SaaS and does nothing else. `create-platform-operator.mjs` creates one that **joins no organization**: no workspace, no data, no customer role. A mistake made while signed in as an operator therefore cannot be a mistake inside a tenant, and the audit trail names a principal with no other purpose.

The password is **never read from argv** — arguments land in shell history and are visible to every process through `ps`. Supply `OPERATOR_PASSWORD`, or let one be generated and printed exactly once:

```sh
OPERATOR_PASSWORD='...' node scripts/create-platform-operator.mjs ops@example.com "Jane Ops" "Initial operator"
```

The account, the grant and two audit records (`user.created`, `platform.admin.granted`) share one transaction, so a created operator without a grant — or a grant with no record of who asked for it — is not a reachable state. Re-running against an existing email is refused, pointing at `grant-platform-admin.mjs` instead.

Because such an account has no workspace, sign-in would otherwise land it on `/onboarding`, a page that tells an operator they are not an admin of any organization and offers them nothing. `landingFor()` in `src/features/auth/actions.ts` sends an account with **no workspace and a live grant** to `/admin` instead; a workspace still wins, because an operator who also belongs to a tenant is signing in as a customer. `/onboarding` additionally renders a link to the control plane for grant holders, so landing there directly is not a dead end either.

Anyone with database access can grant themselves the boundary. That is a property of owning the database, not a weakness of this design; it is the same trust level that can already read every table.

### Step-up authentication

Not implemented. The seam is that **every** page and route passes through `requirePlatformAccess` / `requireApiPlatformAccess` and nothing re-implements the check. Adding a step-up requirement (a fresh password confirmation that marks `sessions.id` elevated for a short window) is therefore a change to those two functions plus one route, not a change to every handler.

## Cross-tenant reads

`src/features/platform/server/platform-repository.ts` queries across tenants. This does **not** weaken Row Level Security and does not need to: the `*_workspace_isolation` policies already pass when `app.workspace_id` is unset (migration 0014), which is what lets migrations, the seed script and the health probe work. Platform statements simply run outside `withWorkspace()`, exactly as those do.

What keeps it from being a bypass is *where* it is allowed to happen:

- every caller passes the platform guard first;
- `tests/unit/platform-isolation.test.ts` fails if anything outside the platform plane imports those modules;
- the same test greps the repository for `password_hash`, `token_hash`, `key_hash`, `ciphertext`, `secret_ref`, `access_token` and `refresh_token`, so widening what an operator can read is a visible decision.

The operator sees tenants, accounts, counts and lifecycle. They do not see conversations, messages, knowledge content, CRM notes or any credential.

## Lifecycle

Migration `0023_platform_control_plane.sql` adds `organizations.status` (`active` / `suspended` / `disabled`) and `users.disabled_at`. Both default to the value every existing row already had, so the migration changes no behaviour until an operator acts.

**Neither state deletes anything.** Suspension is an access decision, which is what makes it reversible and what stops an operator's mistake from being a data-loss incident.

### What suspending an organization closes

| Path | Mechanism |
| --- | --- |
| Dashboard and `/api/v1/w/...` | `requireWorkspaceAccess` / `requireApiWorkspaceAccess` return 403 |
| Workspace API keys | `findApiKeyCredentialByHash` joins on `organizations.status = 'active'` |
| Chatbot turns, agent turns, workflow runs, knowledge processing, MCP calls | `assertWorkspaceActive()` in `src/server/auth/lifecycle.ts` |
| Creating new workspaces | `findMemberRole` / `listUserOrganizations` filter to active |
| Accepting an invitation | `invitation-service` checks status under `FOR SHARE` |

Two asymmetries are deliberate:

- **The workspace switcher still lists a suspended tenant's workspaces.** Hiding them would read as deleted data; opening one gives an explainable 403 instead.
- **A member of a suspended organization gets 403, not 404.** They know the workspace exists, and claiming otherwise looks like data loss.

`assertWorkspaceActive` **fails closed**: a missing row, or a status a future migration adds, refuses. Its error is a generic 503 — an anonymous visitor on a customer's website must not learn that the customer was suspended.

### What disabling a user closes

Sign-in, identity linking, session creation and session resolution. `getAuthContext` filters `disabled_at IS NULL` in its predicate, so every page, action and route treats the account as signed out without knowing the column exists, and `changeUserState` deletes the account's sessions so it takes effect on the next request rather than at cookie expiry.

Re-enabling restores the ability to sign in, never the revoked sessions.

API keys belong to a **workspace**, not to their creator, and remain valid when the creator is disabled. Suspend the organization or revoke the key to stop those credentials.

Two refusals are enforced in the service because the UI cannot be what enforces them: an operator cannot disable **their own account**, and cannot disable **another platform admin**. Both would be lockouts that the product provides no way to undo.

## Audit

`platform_audit_log` is separate from `activity_log` because that table is workspace-scoped (`workspace_id NOT NULL ... ON DELETE CASCADE`): a platform action has no workspace, and deleting a tenant would cascade away the operator's own record of what they did to it.

- Mutations pass the **transaction client**, so a failed audit insert rolls the mutation back. An action that cannot be recorded does not happen.
- Denial logging (`platform.access.denied`) is best effort and runs outside any transaction, so a failing insert cannot turn a correct 404 into a 500 — which would tell an unauthorized caller they had found something.
- Denials are recorded only for callers who proved a session. An anonymous 401 has no actor worth storing and would let anyone write rows.
- A 404 thrown by a *handler* is not a denial. The guard and the handler have separate catches so routine misses do not drown the security signal.
- `redactMetadata()` strips credential-shaped keys (`apiKey`, `api_key`, `API-Key`, tokens, passwords, ciphertext…) recursively, with bounded depth. `actor_email` is denormalized beside `actor_id` so the record still names who acted after an account is deleted.

Reads and writes are locked: `findOrganizationIdentity` and `findUserIdentity` take `FOR UPDATE` and are called **inside** the mutation's transaction, so two operators acting on one tenant at the same moment cannot both pass the no-op check and write two audit rows for one transition.

## Overview and health

`getPlatformOverview()` is four concurrent statements, none of them per-tenant, over indexed columns. If the platform outgrows that, the answer is a materialized rollup on a schedule — not a warehouse, and not client-side aggregation.

Activity figures are summed from `usage_events`, which this application writes on its own request path. They record **what this system metered, not what a provider invoiced**, and the page says so.

Health reports only what the server observes. The database is genuinely probed; the AI gateway and embedding provider report their *configuration* and are labelled **Not monitored**, because a live upstream probe on every dashboard load would spend money and add latency, and a cached one would be a liveness claim with an unstated age. Nothing is drawn green that was never checked.

## The AI catalogue

Migration `0024_ai_registry.sql` adds `ai_providers`, `ai_provider_credentials`, `ai_models` and `embedding_models`. All are platform-owned: no `workspace_id`, no RLS policy, guarded by `requirePlatformAccess`.

**Nothing in the request path reads them yet.** `MODEL_OPTIONS` still supplies the customer UI and `getAiGateway()` still resolves from environment variables. That separation is deliberate and is the subject of the gate below.

### Capability versus availability

Two columns, and the difference is the point:

| Column | Meaning |
| --- | --- |
| `capabilities` | what the model **can** do — a fact about the upstream model |
| `available_for` | what this platform **offers** it for — always a subset |

`CHECK (available_for <@ capabilities)` enforces the subset relation in the database, so a text-only model cannot be offered for vision by ticking a box: the row is not storable. Widening what the platform offers therefore requires first asserting that the model supports it, which is the explicit, visible override rather than a silent one. The Zod schemas mirror the rule so a violation arrives as a field error instead of a failed write, and they refuse a half-supplied pair — validating a new `available_for` against whatever happens to be stored would be a check against a moving target.

The UI shows three states, not two: **offered**, **supported but not offered**, and **not supported**. Collapsing the middle one would leave an operator unable to tell "we chose not to" from "it cannot".

### Provider credentials

Sealed with the existing `secret-box` (AES-256-GCM) — **no second secret system**. What is local to this plane is the binding context: `platform:ai-provider:<id>` versus the workspace form `workspace:<id>:integration:<provider>`. Because the context is bound as additional authenticated data, a ciphertext moved between the two planes fails to decrypt rather than quietly working.

A key can be **set and never read back**:

- No type in `ai-types.ts` has a field a key could occupy — a provider reports `credentialConfigured: boolean`, not a masked value, not the last four characters, not a length.
- The summary projections compute that boolean in SQL (`EXISTS(...)`); only `findProviderCredential` and `upsertProviderCredential` name the ciphertext columns at all.
- Audit rows record `credentialChange: "set" | "cleared"`, never the key.
- `tests/unit/ai-registry.test.ts` asserts all three, and was verified to fail when a credential column was planted in the provider summary.

Omitting `apiKey` leaves the stored key alone, `null` clears it, a string replaces it. Conflating "absent" with "clear" would erase a working credential on every unrelated edit.

### Embedding models

A separate registry rather than a capability flag, because `dimensions` is not descriptive metadata: it is the width of every vector already written with that model. `dimensions` is therefore **absent from the update schema** — changing the embedding model for existing content is a re-embedding job, and a registry entry is replaced rather than re-dimensioned.

## Breaking-change gate: connecting the catalogue

Building the registry was additive. **Making it authoritative is not**, and it is not done.

**1. Current behaviour.** `MODEL_OPTIONS` is duplicated in `src/features/agents/constants.ts` and `src/features/chatbots/constants.ts`, offering four abstract aliases (`""`, `fast`, `balanced`, `quality`). `agents.model_config.model` and `chatbots.model_config.model` accept any string up to 100 characters with no catalogue validation, and `getAiGateway()` resolves one gateway from `AI_PROVIDER` / `AI_GATEWAY_BASE_URL` / `AI_DEFAULT_MODEL`.

**2. Required change.** Replace both lists with a read model over `ai_models` filtered by `available_for`, and validate stored selections against it.

**3. Why.** Otherwise the catalogue is documentation. Disabling a model in `/admin` would not stop a customer selecting it, which makes "model availability is centrally controlled" false.

**4. Affected components.** `agents/constants.ts`, `chatbots/constants.ts`, both `schemas.ts`, `agent-instructions-form.tsx`, `chatbot-instructions-form.tsx`, `agent-engine.ts`, `chatbot-chat.ts`, `chatbot-runtime.ts`, `src/server/ai/index.ts`, and `workflows`' `agent.run` path.

**5. Security implications.** Mostly positive: one server-side resolution point instead of a free-text field reaching the gateway. One new risk — the resolver runs on anonymous widget and public-API paths, so a catalogue lookup per turn must not become an unauthenticated amplification vector, and must fail closed.

**6. Risks.** The serious one: **existing rows hold values no catalogue will contain.** Validating on read breaks every live agent and chatbot storing `fast`/`balanced`/`quality`. A disabled model must also keep working for configurations that already name it, or disabling one silently breaks customers mid-conversation.

**7. Migration requirements.** Seed the catalogue with rows whose `slug` matches each existing alias before enforcement; backfill or alias stored values; introduce validation warn-only first; keep resolution tolerant of unknown values for an agreed window.

**8. Alternatives.** (a) Catalogue advisory, aliases authoritative — no breakage, no control. (b) Resolve server-side but accept any stored value, falling back to the platform default — most of the benefit, no customer breakage, still lets a disabled model run. (c) Full enforcement with the migration above. **(b) then (c)** is the safe sequence.

**9. Recommendation.** Do not enforce in one step. Land (b) — a `resolveModel()` seam in the AI boundary that prefers the catalogue and falls back to today's behaviour — then seed, observe which stored values are unmatched, and only then enforce. This needs your approval before any of it starts.

## What is not here

Deliberately absent, and absent from the navigation too — an item leading to a stub teaches an operator that the plane is unfinished:

- Model **routing** and fallbacks. The registries exist; choosing between their entries is Phase 4 and has no table yet.
- Billing **in the platform plane**. Plan assignment and entitlements now exist, but as a tenant-scoped feature (`src/features/billing`, migration 0028): an owner assigns a plan from within their own workspace's settings. There is still no payment processor, no price, no invoice, and no platform-operator view of who is on what. Cross-tenant plan administration belongs here eventually and is not built.
- Feature flags, platform settings, MCP platform policies, per-tenant cost attribution
- Support impersonation. Not built, and not to be built without the safeguards in its own design: explicit activation, time limits, restricted actions, and a visible indicator.

See the breaking-change gate above for the one step that is designed but deliberately not taken.
