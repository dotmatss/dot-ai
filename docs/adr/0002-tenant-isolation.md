# ADR 0002 — Tenant isolation: explicit workspace scoping plus PostgreSQL RLS

**Status:** Accepted · **Date:** 2026-09-10

## Context

The product is multi-tenant: `User → Organization → Workspace → {chatbots, agents, workflows, knowledge, conversations, CRM, integrations}`. Tenant boundaries are a security boundary and must never depend on client state.

## Decision

- Every tenant table carries `workspace_id`. Repository SQL always filters on it explicitly and takes the workspace id from the server-verified membership (`requireWorkspaceAccess`), never from the request body.
- Multi-statement writes run inside `withWorkspace(workspaceId, fn)` which sets the transaction-local `app.workspace_id`. Row Level Security policies on every tenant table restrict rows to that workspace when the setting is present (defense in depth). When the setting is absent (system jobs, migrations) policies are permissive for the connection role.
- Roles are organization-level (`owner > admin > member > viewer`) and evaluated with `hasMinimumRole`. Reads require `viewer`, writes `member`, destructive or administrative actions `admin`/`owner`.
- Unknown or inaccessible workspaces return **404**, not 403, so their existence is not leaked.

## Consequences

- PostgreSQL superusers bypass RLS: use a dedicated non-superuser database role in shared environments (documented in `docs/environment.md`).
- Aggregate reads for dashboards may use plain `query()` because they still filter by `workspace_id` explicitly.
