-- 0015_mcp
--
-- Model Context Protocol, phase 1: persistence and configuration.
--
-- The platform is an MCP *client*. These tables record which remote servers a
-- workspace has connected, what those servers offer, and which of those tools
-- a person has approved. Nothing here executes a tool; see docs/mcp-evaluation.md.
--
-- Four tables, matching §15 of that document. The fifth table listed there,
-- `mcp_tool_calls`, is deliberately NOT created: it records executions, and
-- phase 1 introduces no execution. An always-empty audit table would be worse
-- than no table, because it would read as though calls were being recorded.
--
-- Two design points worth stating, because they are easy to "simplify" later
-- and both are load-bearing:
--
--  1. Tools and grants are separate tables. A discovered tool is a fact about
--     the server and is rewritten on every discovery; a grant is a decision by
--     a person and must survive it. Merging them is how a re-discovery
--     silently re-grants something nobody looked at.
--  2. `mcp_tool_grants.approved_hash` pins the approval to the tool definition
--     the approver actually saw. A server can redefine a tool under the same
--     name at any time, so the hash is the identity, not the name.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- Streamable HTTP only, and that is a security boundary rather than a backlog
-- item: `stdio` would mean launching a subprocess from customer-supplied
-- configuration, which on shared infrastructure is remote code execution as
-- the service account. A single-value enum makes adding one a schema change.
CREATE TYPE mcp_transport AS ENUM ('http');

CREATE TYPE mcp_auth_kind AS ENUM ('none', 'header');

-- No 'connected' state: protocol revision 2026-07-28 removed sessions and the
-- initialize handshake, so there is no connection to be in. This is the
-- outcome of the last probe.
CREATE TYPE mcp_server_status AS ENUM ('draft', 'active', 'error', 'unauthorized', 'disabled');

-- Ours, assigned by the approver. Never derived from the server's annotations,
-- which the specification requires clients to treat as untrusted.
CREATE TYPE mcp_risk_class AS ENUM ('read', 'write', 'destructive');

CREATE TYPE mcp_grant_state AS ENUM ('active', 'stale', 'orphaned');

-- ---------------------------------------------------------------------------
-- Servers
-- ---------------------------------------------------------------------------
CREATE TABLE mcp_servers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name              text NOT NULL,
  -- Our identifier for the server, used to namespace tool references as
  -- `mcp.{slug}.{toolName}`. Deliberately not the server's self-reported name:
  -- the specification warns that is not unique and must not be relied on for
  -- disambiguation.
  slug              text NOT NULL,
  endpoint_url      text NOT NULL,
  transport         mcp_transport NOT NULL DEFAULT 'http',
  auth_kind         mcp_auth_kind NOT NULL DEFAULT 'none',
  status            mcp_server_status NOT NULL DEFAULT 'draft',
  last_probe_at     timestamptz,
  last_probe_ok     boolean,
  -- Sanitised before storage: host and condition only. Never the endpoint URL
  -- (which can itself be a credential), the credential, or a response body.
  last_probe_message text,
  tool_count        integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);
CREATE INDEX mcp_servers_workspace_idx ON mcp_servers(workspace_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------
-- Mirrors integration_secrets: one sealed AES-256-GCM envelope per server,
-- in its own table so ciphertext stays out of every list query and so "which
-- code can read an MCP credential" is answerable by grepping for this table.
--
-- `header_name` is not secret - it is which header the credential travels in -
-- but it lives here rather than on mcp_servers because it is meaningless
-- without the envelope and should disappear with it.
CREATE TABLE mcp_server_secrets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mcp_server_id  uuid NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  ciphertext     text NOT NULL,
  iv             text NOT NULL,
  tag            text NOT NULL,
  header_name    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mcp_server_secrets_server_idx ON mcp_server_secrets(mcp_server_id);
CREATE INDEX mcp_server_secrets_workspace_idx ON mcp_server_secrets(workspace_id);

-- ---------------------------------------------------------------------------
-- Discovered tools
-- ---------------------------------------------------------------------------
-- A snapshot of what the server offered at the last discovery, validated
-- before storage. Rows are kept rather than deleted when a tool disappears:
-- `removed_at` lets the UI explain why a grant went orphaned instead of the
-- tool simply vanishing from view.
CREATE TABLE mcp_server_tools (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mcp_server_id  uuid NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  name           text NOT NULL,
  title          text,
  description    text,
  input_schema   jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_schema  jsonb,
  -- The four hints the server CLAIMS. Stored so the approval UI can show them,
  -- attributed to the server. Never used as an authorization input.
  annotations    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- sha256 over the canonical representation defined in
  -- src/features/mcp/server/tool-identity.ts. 64 hex characters.
  content_hash   text NOT NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  removed_at     timestamptz,
  UNIQUE (mcp_server_id, name)
);
CREATE INDEX mcp_server_tools_workspace_idx ON mcp_server_tools(workspace_id);
CREATE INDEX mcp_server_tools_server_idx ON mcp_server_tools(mcp_server_id, name);

-- ---------------------------------------------------------------------------
-- Tool grants
-- ---------------------------------------------------------------------------
-- One row per tool a person has approved. `approved_hash` is the pin: it is
-- compared against the tool's current content_hash on every resolution, and a
-- mismatch makes the grant stale rather than letting it authorise a definition
-- nobody reviewed.
--
-- `state` is a cached convenience for listing. It is never the authority:
-- src/features/mcp/grants.ts recomputes the live comparison, because a stored
-- flag can be out of date by exactly the window an attacker wants.
CREATE TABLE mcp_tool_grants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mcp_server_id     uuid NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  tool_name         text NOT NULL,
  approved_hash     text NOT NULL,
  risk_class        mcp_risk_class NOT NULL,
  requires_approval boolean NOT NULL DEFAULT true,
  state             mcp_grant_state NOT NULL DEFAULT 'active',
  granted_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mcp_server_id, tool_name),
  -- Belt and braces for the rule that a destructive tool always needs a
  -- person. The service enforces it too, but a CHECK means no future code
  -- path, migration or manual UPDATE can quietly turn it off.
  CONSTRAINT mcp_tool_grants_destructive_requires_approval
    CHECK (risk_class <> 'destructive' OR requires_approval)
);
CREATE INDEX mcp_tool_grants_workspace_idx ON mcp_tool_grants(workspace_id);
CREATE INDEX mcp_tool_grants_server_idx ON mcp_tool_grants(mcp_server_id, tool_name);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mcp_servers', 'mcp_server_secrets'] LOOP
    EXECUTE format('CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- The predicate is the cast-safe form from 0014: nullif() turns the empty
-- string that a committed set_config leaves behind into NULL first, because
-- PostgreSQL does not guarantee OR short-circuiting and a bare ''::uuid cast
-- would fail unrelated queries on the same pooled connection.
--
-- FORCE is not optional: without it these policies do not apply to the table
-- owner, which is the role the application connects as in most deployments.
DO $$
DECLARE t text;
DECLARE predicate constant text :=
  $p$(
     nullif(current_setting('app.workspace_id', true), '') IS NULL
     OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
   )$p$;
BEGIN
  FOREACH t IN ARRAY ARRAY['mcp_servers', 'mcp_server_secrets', 'mcp_server_tools', 'mcp_tool_grants'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I USING %s WITH CHECK %s',
      t || '_workspace_isolation',
      t,
      predicate,
      predicate
    );
  END LOOP;
END $$;
