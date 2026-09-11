-- 0018_mcp_oauth
--
-- Model Context Protocol, phase 2d: OAuth 2.1.
--
-- Until now a server was reached with a static header credential a person
-- pasted in. That works, and for many servers it is all there is, but it means
-- the customer hands us a long-lived token with whatever scope it happens to
-- carry. OAuth lets the *server* decide what we may do, lets the user consent
-- to it, and lets it be revoked at the source.
--
-- WHAT THE 2026-07-28 REVISION CHANGED
-- ------------------------------------
-- Dynamic Client Registration (RFC 7591) is deprecated in favour of a Client ID
-- Metadata Document: instead of registering and being issued a client id, the
-- client *publishes* its metadata at a URL and that URL **is** the client id.
-- So there is no client secret to store and no registration to keep in step -
-- which is why there is no `client_secret` column below and why `client_id`
-- holds a URL.
--
-- TWO TABLES, AND WHY THEY ARE SEPARATE
-- -------------------------------------
-- `mcp_oauth_states` is the in-flight authorization: it exists between sending
-- a person to the authorization server and their coming back, and then it is
-- deleted. `mcp_oauth_tokens` is the result. Keeping them apart means an
-- abandoned authorization leaves no row that looks like a credential, and the
-- PKCE verifier - which is a secret for exactly one exchange - cannot outlive
-- the exchange it belongs to.

-- The third authentication kind. Added as a value rather than a new column so
-- every existing read keeps working; PostgreSQL 12+ allows this inside a
-- transaction as long as the new value is not used in the same transaction,
-- and nothing below inserts one.
ALTER TYPE mcp_auth_kind ADD VALUE IF NOT EXISTS 'oauth';

-- ---------------------------------------------------------------------------
-- In-flight authorizations
-- ---------------------------------------------------------------------------
CREATE TABLE mcp_oauth_states (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mcp_server_id            uuid NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,

  -- The CSRF token for the authorization round trip. Unique because a repeat
  -- is either a replay or a bug, and both should fail rather than be guessed at.
  state                    text NOT NULL UNIQUE,

  -- The PKCE verifier, sealed like any other secret. It is what proves the
  -- code being redeemed was requested by us, so it is the one value here that
  -- must never be readable from the database alone.
  verifier_ciphertext      text NOT NULL,
  verifier_iv              text NOT NULL,
  verifier_tag             text NOT NULL,

  -- Everything discovery resolved, captured at the moment the flow started.
  -- Stored rather than re-discovered on the way back: a server that changes
  -- its metadata mid-flow must not be able to redirect our token exchange
  -- somewhere else.
  issuer                   text NOT NULL,
  authorization_endpoint   text NOT NULL,
  token_endpoint           text NOT NULL,
  client_id                text NOT NULL,
  scope                    text,
  -- RFC 8707: the resource we are asking for a token *for*, so a token issued
  -- for one MCP server cannot be replayed at another.
  resource                 text NOT NULL,
  redirect_uri             text NOT NULL,

  created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Short. An authorization a person walked away from is not a pending task.
  expires_at               timestamptz NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_oauth_states_workspace_idx ON mcp_oauth_states(workspace_id);
CREATE INDEX mcp_oauth_states_expiry_idx ON mcp_oauth_states(expires_at);

-- ---------------------------------------------------------------------------
-- Issued tokens
-- ---------------------------------------------------------------------------
CREATE TABLE mcp_oauth_tokens (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mcp_server_id            uuid NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,

  -- Recorded so a token is only ever sent back to the issuer that minted it.
  issuer                   text NOT NULL,
  token_endpoint           text NOT NULL,
  client_id                text NOT NULL,
  -- The RFC 8707 resource this token was minted for. Stored rather than
  -- re-derived at refresh time: a refresh must name the same resource as the
  -- original grant, and deriving it again from the server's current endpoint
  -- would silently change it if somebody edited the endpoint.
  resource                 text NOT NULL,
  -- What the server actually granted, which may be less than we asked for.
  scope                    text,

  access_ciphertext        text NOT NULL,
  access_iv                text NOT NULL,
  access_tag               text NOT NULL,
  -- Null when the server issues tokens that do not expire. Refresh is driven
  -- off this, with a margin, rather than off a failed request.
  access_expires_at        timestamptz,

  -- Absent when the server issues no refresh token, in which case the
  -- connection simply needs re-authorizing when the access token dies.
  refresh_ciphertext       text,
  refresh_iv               text,
  refresh_tag              text,

  -- Set when a call came back with `insufficient_scope`, so the UI can ask for
  -- the step-up rather than silently failing every call from then on.
  needs_scope              text,

  authorized_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- A refresh token is three columns or none of them. Half a sealed secret is
  -- unopenable, and storing one would look like a capability we do not have.
  CONSTRAINT mcp_oauth_tokens_refresh_is_whole
    CHECK ((refresh_ciphertext IS NULL) = (refresh_iv IS NULL) AND (refresh_iv IS NULL) = (refresh_tag IS NULL))
);
CREATE UNIQUE INDEX mcp_oauth_tokens_server_idx ON mcp_oauth_tokens(mcp_server_id);
CREATE INDEX mcp_oauth_tokens_workspace_idx ON mcp_oauth_tokens(workspace_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE TRIGGER mcp_oauth_tokens_set_updated_at
  BEFORE UPDATE ON mcp_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- The same cast-safe predicate and the same FORCE as every other tenant table.
DO $$
DECLARE t text;
DECLARE predicate constant text :=
  $p$(
     nullif(current_setting('app.workspace_id', true), '') IS NULL
     OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
   )$p$;
BEGIN
  FOREACH t IN ARRAY ARRAY['mcp_oauth_states', 'mcp_oauth_tokens'] LOOP
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
