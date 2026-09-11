# MCP Phase 2 — execution security gate

**Status: 2a, 2b, 2c and 2d implemented. 2e not started. MCP tools execute; see the outcome sections at the end.**

This gate exists because of one specific hole: the egress guard decides whether a destination is allowed by resolving a **hostname**, and then connects by handing that **same hostname** to `fetch`, which resolves it again. The decision and the connection are made on two separate DNS answers. Closing that is a precondition for execution, not a follow-up.

Every claim below was verified by running code against this project's installed dependencies. Where something could not be verified in this environment it says so.

---

## 1. Current network execution architecture

```text
mcp-client.ts
  └─ StreamableHTTPClientTransport(url, { fetch: createGuardedFetch({ timeoutMs }) })
        └─ guardedFetch(url, init)            src/server/http/egress-guard.ts
             ├─ checkWebhookUrl(target)        scheme, embedded credentials, port, literal address
             ├─ assertPublicDestination(host)  dns.lookup(all, verbatim) → isBlockedIpAddress per address
             ├─ globalThis.fetch(url, { redirect: "manual", signal, cache: "no-store" })
             │     └─ Node's internal undici  ←── RESOLVES THE HOSTNAME AGAIN, independently
             │           └─ TCP/TLS socket
             └─ loop: re-apply both checks to every redirect hop
```

Verified facts about this path:

| Question | Answer |
| --- | --- |
| How are hostnames resolved for validation? | `dns.lookup(host, { all: true, verbatim: true })`, and **every** returned address is checked, not just the first |
| What is rejected? | Non-http(s) schemes, embedded credentials, non-standard ports, and loopback / private / link-local / reserved literals, via the shared `isBlockedHostname` and `isBlockedIpAddress` predicates |
| Are redirects revalidated? | Yes. `redirect: "manual"`, and the full policy plus a fresh DNS check runs on every hop. Confirmed by test |
| Who creates the socket? | Node's **internal** undici, reached through `globalThis.fetch`. Under Next.js that global is additionally patched for caching; `cache: "no-store"` is passed for that reason |
| Can the validated address be pinned on this path? | **No.** Node's built-in `fetch` exposes no `lookup` and no way to construct its internal dispatcher |
| Does passing an npm-undici dispatcher to global `fetch` work? | **No.** It throws `TypeError: fetch failed (cause: invalid onRequestStart method)` — version skew between Node's internal undici and npm `undici@8.10.2` |
| Is `undici` available? | Only as a **dev-only transitive** of `jsdom`. Not a direct dependency, so not guaranteed present at runtime |
| Is proxy configuration honoured? | No. Node 22's built-in fetch ignores `HTTP_PROXY`/`HTTPS_PROXY`; `NODE_USE_ENV_PROXY` is not set. Nothing in the process configures a proxy today |
| Can in-process code reroute our requests? | **Yes.** Verified: `setGlobalDispatcher()` from the npm undici *does* affect `globalThis.fetch`. Any dependency could silently reroute every global fetch, ours included |

## 2. The confirmed window

**Two resolutions, one decision.** `assertPublicDestination` resolves the name, validates every address, and then **discards the addresses**. Only the hostname is passed on. Node's undici resolves it again when it opens the socket. Nothing carries the decided address into the connection.

An attacker who controls the DNS for a hostname they gave us needs only to answer the first query with a public address and the second with `169.254.169.254`, `127.0.0.1` or an RFC 1918 address. TTL is theirs to set; the window is ours to lose.

What the current guard *does* close, and should be credited for: it checks every address in a multi-answer response, so a record mixing one public and one private address is refused outright rather than depending on which address is chosen. The residual hole is a DNS answer that **changes**, not one that is mixed.

**Exposure today, stated honestly.** Phase 1 only probes and lists tools. A successful rebind therefore yields a POST to an internal address whose response is parsed as JSON-RPC, and any tool-shaped metadata in it is stored and shown to an admin. That is an internal-network read primitive with a narrow exfiltration channel: real, and bounded by the response-size cap and the validation that rejects malformed tools. Execution changes the calculus, because then attacker-influenced **arguments** go out and **results** come back into a model's context. This is the right gate to stop at.

## 3. Root cause

The security decision is made about a **name**. The socket is opened using a **name**. The address that was actually validated is never used for anything.

## 4. Candidate solutions

### Option A — custom dispatcher, pinning the socket to the validated address

An `undici.Agent` whose `connect.lookup` returns only the address we already validated, while the request URL keeps the original hostname.

**Verified working.** Over real TLS: HTTP 200, `lookup` called once with the hostname, certificate validated, and the `Host` header arrived as the original hostname.

| Property | Result |
| --- | --- |
| DNS rebinding | Closed at this layer. The socket goes to the address the policy approved; undici performs no second resolution |
| IPv4 | Verified against a real host |
| IPv6 | **Unverified here.** AAAA records resolve but this environment has no IPv6 egress (`ENETUNREACH`). The design must pass `family` through; the behaviour needs confirming where IPv6 egress exists |
| HTTPS / SNI | Correct, and for the right reason: only DNS is overridden, so the URL, SNI and `Host` all still carry the hostname. Verified `authorized: true`, `servername: example.com` |
| Redirects | Unchanged. Still manual, still revalidated per hop, and each hop now gets its own pin |
| Connection pooling | A per-request Agent means no reuse. Also a benefit: a socket validated for an earlier request can never be reused under a later decision |
| Keep-alive | Lost with a per-request Agent. Measured cost: **162ms vs 89ms** per request, about 70ms of extra TLS handshake |
| Proxy | Bypassed entirely. See §7 |
| In-process tampering | **Improved.** Verified that an explicit per-request `dispatcher` wins over a hijacked `setGlobalDispatcher`; the current global-fetch path does not |
| Complexity | Low. Roughly 30 lines inside the existing guard |
| Testability | Good. The lookup is a function we own and can assert on |
| Cost | `undici` becomes a **direct runtime dependency** |
| SDK compatibility | One wrinkle: `undici.fetch` returns a Response that is **not** `instanceof globalThis.Response`. The SDK does that check in two places, both inside `parseErrorResponse` (an OAuth error path). Mitigation: re-wrap into a global `Response` before returning. The guard already does this for non-streaming bodies; it must also do it for event streams |

### Option B — custom DNS lookup integration

In undici this *is* Option A: `connect.lookup` is the mechanism. There is no separate, cheaper form of it, because **Node's built-in fetch accepts no lookup and no dispatcher we can build**. Verified: handing it an npm-undici dispatcher fails outright. So "pin the DNS without a new dependency, still using `fetch`" is not an available option.

### Option C — `node:https` with a `lookup` option

**Verified working**, with correct TLS: `authorized: true`, `servername: example.com`, and no new dependency.

The cost is an adapter: `https.request` is not fetch-shaped, so we would build the `Response`, the streaming body, header translation and abort wiring ourselves, and hand that to the SDK. That is a meaningful amount of new code in the most security-sensitive path we have, and every bug in it is ours. It also forgoes undici's HTTP handling, which the MCP transport is written against.

Worth keeping as the fallback if adding a dependency is refused.

### Option D — rewrite the URL to the validated IP and override `Host`

**Rejected on correctness.** Connecting to `https://93.184.216.34/` makes TLS validate the certificate against the IP, which fails for virtually every real server, and `fetch` gives no way to set the TLS `servername` independently. It would also mean the MCP required-header mirroring describes a different authority than the connection. This is the tempting shortcut and it is wrong.

### Option E — egress proxy

An outbound proxy that enforces destination policy at the network layer, which the MCP specification's own guidance recommends. Complementary rather than alternative, and not a code change. See §7 and §11.

## 5. Recommended solution

**Option A, implemented inside the existing guard, with the existing checks untouched.**

```text
customer-supplied URL
   → checkWebhookUrl            unchanged   scheme, credentials, port, literal address
   → assertPublicDestination    unchanged   resolve all, validate every address
   → CHOOSE one validated address           new
   → undici.fetch(url, { dispatcher: Agent({ connect: { lookup: () => thatAddress } }) })
   → socket goes to exactly that address; URL, SNI and Host keep the hostname
   → re-wrap into a global Response
   → per redirect hop, repeat all of the above
```

The guard stays the policy layer. Pinning is an additional step that makes the policy's conclusion binding on the socket, which is precisely what the brief asks for and is why no existing check is removed or relaxed.

A **fresh Agent per request**, accepting the ~70ms handshake, because a pooled socket carries an address validated at some earlier moment under some earlier policy. For MCP that trade is clearly worth it; if latency later matters, the alternative is a pinned-resolution cache with a short TTL, which is more code and more room for error.

## 6. Exact components that must change

| Component | Change | Risk |
| --- | --- | --- |
| `src/server/http/egress-guard.ts` | Add address selection and a pinned dispatcher; switch the call from `globalThis.fetch` to `undici.fetch`; re-wrap event-stream responses too | Medium. It is the shared egress path |
| `package.json` | Add `undici` as a direct runtime dependency, pinned | Low, but it is a dependency decision and needs approval |
| `tests/unit/mcp-egress-guard.test.ts` | Currently mocks `node:dns/promises` and stubs `globalThis.fetch`; must instead assert on the dispatcher's lookup and the address handed to it | Medium. Existing tests must be rewritten, not deleted |
| `src/features/mcp/server/mcp-client.ts` | No change expected. It only passes the guard's fetch to the transport | Low, to be confirmed by the suite |
| `src/features/integrations/server/connection-test.ts` | **Has the same window.** It calls `assertPublicDestination` then its own `globalThis.fetch` loop | See below |
| `src/features/knowledge/server/url-ingest.ts` | **Has the same window.** Its own per-hop fetch loop over a customer-supplied URL | See below |

### The breaking-change consideration

The brief asks me to identify impact before touching shared networking. The honest position: **two existing callers have the same vulnerability**, and the shared fix should cover them. Migrating them would change proven, tested code paths that are not part of Phase 2 and whose tests stub `globalThis.fetch`. That is shared-infrastructure and integration-test-infrastructure change, so I am not doing it as a side effect of the MCP work. It is decision 3 in §11.

## 7. Security implications

**Improved by this change.** DNS rebinding closed at the connection layer. Explicit per-request dispatchers are immune to an in-process `setGlobalDispatcher` hijack, which the current path is not. Next.js's fetch patching is no longer in the request path for MCP traffic. Per-request agents remove cross-request socket reuse.

**Unchanged.** Every existing policy check, in the same order, on every hop. Credentials still sealed with a workspace-bound key and never logged. Response size caps and timeouts still apply.

**The proxy trade-off, stated because it is easy to miss.** Pinning and proxying are mutually exclusive at this layer. If traffic goes through an egress proxy, the proxy resolves the name and the proxy becomes the enforcement point; our pin would be meaningless or actively wrong. So a deployment chooses one: pin at the application, or proxy at the network and enforce there. Choosing both without deciding which is authoritative would give the illusion of two controls and the reality of neither.

**Residual risks after the change.**
- **IPv6 unverified** in this environment.
- **A public address that is internally routable.** Address-family checks cannot see that `203.0.113.10` is your own datacentre. Only an allowlist or a network control can.
- **The MCP server itself remains untrusted.** Pinning stops us connecting somewhere unintended; it does nothing about what an intended server returns. Tool metadata validation, hash pinning and treating results as data remain the controls there.
- **No DNSSEC or resolver trust.** We trust the resolver Node is configured with.

## 8. Testing strategy

Extend, never weaken. The current 20 egress tests all describe policy behaviour that must still hold.

- **Unit, no network.** Mock the DNS layer and assert the address handed to the dispatcher's lookup is exactly the one validated. Assert the lookup returns only that address, in both the `all: true` and single-answer call shapes, with the correct `family`.
- **The rebinding test that matters.** A DNS mock that answers public on the first call and private on the second, proving the connection still goes to the first address. This test is the reason for the whole change and it is currently impossible to write.
- **A local server, real sockets.** Pin an unresolvable hostname to a loopback listener and assert the `Host` header arrives as the hostname. This is how I verified the mechanism, and it belongs in the suite.
- **Per-hop pinning.** A redirect whose second hop resolves privately must be refused, as it is now.
- **Response identity.** Assert the returned object is `instanceof globalThis.Response` for both JSON and event-stream responses, so the SDK's OAuth error path cannot silently degrade.
- **TLS correctness.** One opt-in test against a real host, skipped without network, asserting a pinned connection still validates the certificate.
- **Regression.** The full suite, which includes the MCP persistence integration tests and the connection-tester tests.

## 9. Performance and operational implications

| | Current | Pinned, per-request Agent |
| --- | --- | --- |
| Measured latency | 89ms with keep-alive | 162ms |
| Extra DNS queries | One per request (ours) plus one per connection (undici's) | One per request, total. Slightly **fewer** |
| Sockets | Pooled by Node | One per request |

Operationally: one new runtime dependency to track; proxy support forgone at this layer; and the MCP timeout budget should absorb the extra handshake, which `MCP_LIMITS.requestTimeoutMs` of 10s comfortably does.

## 10. Phase 2 implementation plan

Sequenced so that nothing executes until the network path is settled.

**2a — Close the window.** The change in §6, its tests, and documentation. No execution.
**2b — Execute, behind everything already built.** `callTool` through the pinned guard, gated by grant, hash pin and approval, with `mcp_tool_calls` created for the audit record. Results enter the model as data in a delimited block, never as instructions.
**2c — Approvals queue.** Turn `approval_required` from a status into something a person acts on.
**2d — OAuth 2.1.** Discovery, `resource` indicator, `iss` validation, step-up scopes. Note its discovery fetches must go through the same pinned guard, which is exactly the SSRF vector the specification warns about.
**2e — Workflow node and chatbot support.** Separate decisions, each with its own gate.

## 11. Remaining unresolved decisions

These need your answer before 2a starts.

| # | Decision | My recommendation |
| --- | --- | --- |
| 1 | Add `undici` as a direct runtime dependency (Option A), or build the `node:https` adapter instead (Option C)? | **Option A.** Verified working, ~30 lines, and the adapter would be new hand-written code in the most sensitive path we have |
| 2 | Per-request Agent at ~70ms, or a pinned-resolution cache to keep keep-alive? | **Per-request.** Correctness first; revisit only if measurement says it matters |
| 3 | Migrate `connection-test.ts` and `url-ingest.ts` to the pinned guard in 2a? | **Yes, in 2a.** They have the same hole, and leaving two known-vulnerable callers to fix a third is hard to defend. It does mean rewriting their tests |
| 4 | Accept IPv6 pinning as unverified, or require verification where IPv6 egress exists first? | **Accept with a stated gap**, and verify at deployment. Blocking on it here would block on an environment limitation |
| 5 | Is an egress proxy part of the production design? | Decide before 2a, because per §7 it makes application-level pinning redundant and the two must not both be treated as authoritative |
| 6 | Should the guard refuse to run when a global dispatcher has been replaced? | Worth considering. It is detectable, and a silent reroute of egress is exactly the kind of thing that should fail loudly |

*(Historical: these six were the open questions before 2a. All were answered; see "Decisions as taken" below.)*

---

## Execution gate checklist

| Item | State |
| --- | --- |
| Egress TOCTOU strategy | **Closed in 2a** (§5; see Outcome) |
| DNS resolution strategy | Done — validate every address, pin **all** of the validated ones |
| Actual socket destination control | Done — per-request `Agent({ connect: { lookup } })` |
| Redirect handling | Done in Phase 1; pinned freshly per hop in 2a |
| IPv4 / IPv6 behaviour | Both done. IPv6 verified against a real `::1` socket; public IPv6 egress remains a deployment property |
| HTTPS / SNI behaviour | Verified correct against a real host: hostname preserved, certificate validated |
| Proxy behaviour | **Decided: no proxy.** Application-level pinning is the single enforcement point |
| Pooling / keep-alive | Done — none, per-request agent (~99ms of the ~103ms measured cost) |
| MCP SDK integration | Verified, with the Response re-wrap noted |
| Secret handling during execution | Done in Phase 1: workspace-bound seal, never returned or logged |
| Workspace / tenant isolation | Done in Phase 1: RLS forced, explicit filters, integration-tested |
| Tool authorization | Done in Phase 1: default-deny per tool |
| Content-hash pin validation | Done in Phase 1, tested both ways |
| Approval enforcement | Done in Phase 1 for resolution; the queue is 2c |
| Timeout limits | Done in Phase 1 |
| Response-size limits | Done in Phase 1 |
| Rate limiting | Done in Phase 1 for probe and discover; execution needs its own ceilings |
| Execution cancellation | Mechanism in place (`AbortSignal`, stream close is the MCP cancel signal); unused until 2b |
| Audit logging | Configuration events done; the call record is 2b |
| Error handling | Done in Phase 1: classified, sanitised, no URL or credential in a message |
| Observability | Partial. Probe results stored; per-call observability is 2b |

---

## Outcome — Phase 2a, implemented

Phase 2a is done: the egress TOCTOU window is closed for all three
customer-controlled outbound paths. Phase 2b execution remains unstarted and
unapproved.

### Decisions as taken

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | `undici` or a `node:https` adapter | `undici`, direct runtime dependency, `^7.29.1` |
| 2 | Per-request Agent vs a resolution cache | Per-request. No cache, no pooling |
| 3 | Migrate the other two callers in 2a | Yes. Both migrated in this change |
| 4 | IPv6 | Verified against a real IPv6 socket, not merely accepted as a gap |
| 5 | Egress proxy | Not part of the design. Application-level pinning is the single enforcement point; see the note in `security.md` |
| 6 | Refuse to run when the global dispatcher is replaced | Not added, per instruction. An explicit per-request dispatcher already wins over a replaced global one, and a test asserts nothing in `src/` calls `setGlobalDispatcher` |

One deliberate departure from the proposal: §5 said "validate all, pin one".
The implementation pins **all** the validated addresses, in resolver order. The
security property is identical — every address in the set passed the same check
— and it keeps dual-stack selection and failover working instead of pinning a
single address that may be the one that is down.

### Two corrections to this document

**§4, on npm-undici and Node's built-in `fetch`.** This document recorded that
passing an npm-undici dispatcher to `globalThis.fetch` fails with `invalid
onRequestStart method`. That is correct, but it is **version-specific** rather
than a property of built-in `fetch`. Measured on Node 22.17.0:

| Combination | Result |
| --- | --- |
| undici 8.10.2 + built-in `fetch` | Fails: `invalid onRequestStart method` |
| undici 8.10.2 + `undici.fetch` | Works |
| undici 7.29.1 + built-in `fetch` | **Works**, and returns a native `globalThis.Response` |
| undici 7.29.1 + `undici.fetch` | Works |

So on 7.29.1 the simpler "keep using `globalThis.fetch`, just pass a
dispatcher" shape was in fact available. It was **not** taken, because
`init.dispatcher` is not part of Node's documented `fetch` API: if a future
Node ignored it, the pin would disappear silently while requests kept
succeeding — a fail-open. `undici.fetch` honours the dispatcher by its own
contract, works on both versions, and fails closed. The cost of that choice is
the `Response` re-wrap, which was needed anyway.

As a second line of defence the guard asserts its pinned `lookup` was actually
invoked, and refuses the response otherwise. That assertion is after the
connection, so it detects a broken pin rather than preventing that one request.

**§9, on the expected latency.** The estimate was ~70ms. Measured against a
real HTTPS host from a development machine, 8 requests each, medians:

| Path | Median |
| --- | --- |
| Pooled, connection reused (the old behaviour) | 65ms |
| Fresh default agent per request, no pin | 163ms |
| Fresh **pinned** agent per request (the new behaviour) | 168ms |
| `dns.lookup` alone | ~0ms (OS-cached) |

The real increase is therefore **~103ms per request, not ~70ms**. Almost all of
it — ~99ms — is the loss of connection reuse, which was the accepted trade-off
in decision 2; only **~4ms is attributable to pinning itself**. Latency is
per-request because nothing is pooled, so the figure scales with request count
on a deployment's own network, not with this one.

### Verified in this change

- TLS against a real HTTPS server with the address pinned: HTTP 200, hostname
  preserved in the URL and the Host header, certificate verified at default
  settings.
- The connector asks with `all: true` and requires the **array** callback form.
  The scalar `callback(null, address, family)` form throws `Invalid IP address:
  undefined`, which is a trap for anyone editing this code later.
- undici's `Response` is not `instanceof globalThis.Response`, but its body
  **is** a platform `ReadableStream`, so the re-wrap preserves streaming. An
  SSE response arrives incrementally through it.
- `undici` inlines its llhttp WASM as base64 and reads no `.wasm` from disk, so
  it survives server bundling without a `serverExternalPackages` entry.

---

## Outcome — Phases 2b, 2c and 2d, implemented

### The finding that came first

Phase 1 built the MCP permission model but **nothing called it**. `resolveMcpToolCall`,
`attachedToolRefs` and `grantedToolRefs` had no call sites: the agent runtime
never offered an MCP tool to a model and never resolved one. The feature was
reachable only through its own configuration UI.

A second finding explains why that was not noticed: the AI gateway sent no
`tools` array to the provider. It parsed `tool_calls` deltas but never
advertised a tool, so no provider would emit one. Tool calling was unreachable
end to end, for built-in tools as well.

A third, in the same area: `agents.tools` holds built-in settings and MCP
attachments in one jsonb column, and the write path replaced the column with
built-ins only. The first save of the tools panel silently deleted every MCP
attachment. `composeToolsColumn` now owns that write and
`tests/unit/agents-tools.test.ts` asserts the round trip.

### 2b — execution

- `mcp_tool_calls` (migration 0017) is both the audit log and the approvals
  queue. Two status columns, not one: `resolution` says *why* (the same
  vocabulary the pure resolver returns), `status` says *what happened*.
- Authorization is decided **at the point of use**. The rows are re-read in
  `mcp-execution.ts` rather than trusted from the snapshot the turn loaded, so
  a grant revoked between the model being told about a tool and the model
  asking for it refuses the call.
- The attempt is recorded **before** the request leaves, as `running`. A
  process that dies mid-call leaves a row saying we tried and never learned the
  outcome — for a destructive tool, "no row" and "did not run" must not look
  the same.
- Refusals are recorded too. A log of successes cannot answer "did anything
  try".
- Results reach the model inside a fence carrying a **per-call nonce**, with an
  explicit instruction not to obey them. A fixed delimiter can be closed by the
  tool's own output; a random one cannot.
- Bounded in both directions: `maxArgumentBytes`, `maxResultBytes`,
  `maxResultTextLength`, `callTimeoutMs`, `maxCallsPerTurn`.

The AI boundary was extended to make this reachable: `ChatMessage` gained
`toolCalls`/`toolCallId`, `ChatCompletionRequest` gained `tools`, and the
gateway now sends `tools` + `tool_choice: "auto"` and maps both tool message
shapes. Provider function names are `[a-zA-Z0-9_-]{1,64}`, which our dotted
references are not, so a per-turn name↔reference map is built in `agent-mcp.ts`.

**MCP executes alone.** The six built-in agent tools remain simulated, by
decision. MCP is the only tool path with a per-tool grant made by a person, a
content-hash pin on what they approved, a risk classification and an approval
gate, so it is the only one where "run it" is a decision somebody actually made.

### 2c — approvals queue

`approval_required` stopped being a dead end. A call that needs a person is
`awaiting_approval` on the same row and waits.

**Approving is not bypassing.** Saying yes authorises one call which is then
re-checked from scratch: the grant, the content hash, the server's status and
the agent's own configuration are all read again, and a call that would no
longer be allowed is refused with the reason recorded even though a person
approved it. The transition out of the queue is a conditional update, so two
reviewers cannot both run the same call. Arguments come from the stored row,
never from the request.

### 2d — OAuth 2.1

Discovery is the dangerous part: every URL comes from a document the customer's
server controls and each one makes us issue another request. All of it goes
through the pinned egress guard, and every document is validated before use.

| Control | Where |
| --- | --- |
| PKCE S256, verifier sealed and single-use | `mcp_oauth_states`, deleted on redemption |
| `state`, single-use, and the only thing that identifies the flow | the callback takes neither workspace nor server from the query string |
| `resource` (RFC 8707) on authorization, exchange and refresh | stored on the token row so a refresh cannot move the audience |
| `iss` (RFC 9207), compared in constant time | `completeMcpOauth` |
| Issuer match in authorization-server metadata | closes the mix-up attack |
| Endpoints must be https and on the issuer's origin | `readAuthorizationServerMetadata` |
| S256 advertised, or refuse the server | we are a public client |
| Step-up on `insufficient_scope` | recorded against the connection, surfaced in the UI |

No client secret exists: revision 2026-07-28 deprecates Dynamic Client
Registration in favour of a Client ID Metadata Document, so `client_id` is the
URL of a document we publish at `/api/mcp/client-metadata`.

### 2e — not implemented

The workflow node is tractable: `domain/node-types.ts` is a clean registry and
a `tool.mcp_call` entry plus an executor branch would follow the existing
`tool.http_request` shape.

**The chatbot half needs a decision first, and it is not the one already
given.** Chatbots are the anonymous public-widget path. Giving them MCP tools
creates a route from an anonymous visitor's prompt to real side effects on a
customer's systems — prompt injection with consequences, from someone who never
signed in. When "everything through 2e" was approved, what was flagged was that
it reverses the agents-only restriction; this specific consequence was found
later, on reading the chatbot runtime. It also needs a further schema change,
since `chatbots` has no tools column at all.

The safe shape, if it is wanted: chatbots restricted to `read`-classified tools
with everything else refused outright, rather than merely queued — a queue does
not help when the requester is anonymous and gone.
