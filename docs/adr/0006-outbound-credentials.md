# ADR 0006 — Outbound credentials: a tenant-scoped store, not environment variables

**Status:** Accepted · **Date:** 2026-09-15

## Context

Two directions of authentication were being conflated.

`api_keys` (Developer → API keys, moved out of Integrations when this landed) is **inbound**: a key there authenticates a caller *as* a workspace when it reaches our public API. Only a hash is stored, deliberately, so the plaintext no longer exists anywhere we control.

Nothing covered the **outbound** direction: a workflow calling somebody else's API on a workspace's behalf. The catalogue integrations (`integration_secrets`, migration 0011) and MCP servers each hold credentials, but both are closed sets — a provider must exist in `src/features/integrations/registry.ts`, or the destination must speak MCP. For anything else, the only place to put a token was the `headers` map of a `tool.http_request` step, which lives in the workflow definition: unencrypted JSON, read back into the builder, and carried along by every export, duplicate and diff of that workflow.

The obvious alternative — and the one self-hosted automation tools such as n8n offer — is to read the token from the process environment.

## Decision

1. **Outbound credentials are rows, scoped to a workspace.** `workspace_credentials` + `workspace_credential_secrets` (migration 0026), sealed with the existing AES-256-GCM secret box, bound to `workspace:<id>:credential:<credential id>` so an envelope is useless on any other row or in any other tenant.
2. **Environment variables stay platform configuration.** `src/config/env.ts` keeps its closed, boot-validated schema for `DATABASE_URL`, `APP_SECRET`, `AI_GATEWAY_API_KEY` and the like. It is not a tenant secret store and no tenant value is ever read from `process.env`.
3. **A workflow definition holds a reference, never a value.** `tool.http_request` gained `credentialId`; the header is assembled by the server at run time and merged into the outgoing request *after* the step summary is built, so the value cannot reach the run row or an API response whatever the header is named.
4. **One module decrypts for sending.** `credential-resolver.ts` is the named read model other features import. Features do not query `workspace_credentials`; they ask for a header and get a header.
5. **Admin-only, matching API keys.** A stored credential lets any workflow in the workspace act as that workspace against a third party, which is a privilege grant rather than an ordinary edit.

## Alternatives

- **Environment variables (the n8n-style answer).** Rejected on structure, not taste. One process serves every workspace, so an environment variable is per-deployment: there is no variable name that can mean "*this* workspace's Stripe key", a customer cannot rotate their own credential without an operator restarting the deployment, and any workspace whose workflow could read one could read them all. It works in n8n because self-hosted n8n is single-tenant — the operator and the workflow author are the same person. Note that n8n's own primary mechanism is **Credentials**, encrypted at rest and referenced by nodes, which is what this ADR adopts; environment access in expressions is a self-hosted convenience layered on top and is not offered on n8n Cloud.
- **Extend the integration registry instead.** Would require writing a connector per destination. The registry stays the right home for providers with real behaviour (a connection test, a payload shape); a generic credential is what lets a workspace reach an API we have not written a connector for.
- **One table with the ciphertext inline.** Rejected for the reason migration 0011 gives: a separate secret table keeps ciphertext out of every list query and keeps "which code can read a secret" answerable by grepping for the table name.
- **Store the credential encrypted inside the workflow definition.** Rejected: it makes rotation a per-workflow edit and puts secret material into data that is exported and duplicated by design.

## Consequences

- Rotating a credential is one edit in one place, and every workflow using it picks it up on the next run.
- Deleting a credential cascades to its envelope, so the value is genuinely destroyed. Steps referencing it then fail with "the credential for this step is no longer available" — deliberately not repaired by rewriting another feature's definitions.
- Values are write-only end to end: no endpoint returns one, so the edit form can offer Replace but can never show what is currently stored. An operator who loses a value re-enters it.
- Rotating `APP_SECRET` makes every stored credential unreadable. The failure is reported as "re-enter it", the same recovery integration secrets already have.
- The egress controls for `tool.http_request` are unchanged: the step still requires `allowOutbound`, an explicit host allowlist, and `checkOutboundUrl`, and it still refuses to follow redirects (`redirect: "manual"`), which is what keeps a credential from being replayed to a redirect target. Consolidating that path onto `createGuardedFetch` (see `docs/feature-conventions.md`) remains open and is unaffected by this decision.
