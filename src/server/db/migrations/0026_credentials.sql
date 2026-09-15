-- 0026_credentials
--
-- Outbound credentials: what this workspace may use to authenticate ITSELF to
-- somebody else's API.
--
-- THE DISTINCTION THIS TABLE EXISTS TO DRAW
-- -----------------------------------------
-- `api_keys` (migration 0001, indexed in 0011) is the INBOUND direction: a key
-- there authenticates a caller as this workspace when it hits our public API.
-- Nothing in that table is usable for an outbound request - we store only a
-- hash, on purpose, so the plaintext no longer exists anywhere we control.
--
-- This table is the OUTBOUND mirror. A workflow step that calls Stripe, a
-- customer's ERP, or any API we have not written a connector for needs a token
-- we can actually send, which means reversible encryption rather than a hash.
--
-- WHY NOT ENVIRONMENT VARIABLES
-- -----------------------------
-- The obvious alternative, and the one self-hosted automation tools use, is to
-- read the token from `process.env`. It does not work here, for reasons that
-- are structural rather than stylistic:
--
--   1. One process serves every workspace. An environment variable is
--      per-deployment, so every tenant would read the same value. There is no
--      variable name that can mean "this workspace's Stripe key".
--   2. A customer could not rotate their own credential without an operator
--      editing the deployment and restarting it.
--   3. `src/config/env.ts` is validated at boot against a closed schema, which
--      is exactly right for platform configuration (DATABASE_URL, APP_SECRET,
--      AI_GATEWAY_API_KEY) and exactly wrong for an open set of values that
--      tenants add at runtime.
--
-- Environment variables remain correct for the platform's own configuration.
-- They are not a tenant-scoped secret store, and this table is.
--
-- TWO TABLES, SAME REASON AS 0011
-- -------------------------------
-- `workspace_credential_secrets` holds the sealed envelope so ciphertext stays
-- out of every list query, and so "which code can read a secret" stays
-- answerable by grepping for the table name. The envelope is AES-256-GCM via
-- src/features/integrations/server/secret-box.ts, bound to
-- `workspace:<id>:credential:<credential id>`, so a row lifted into another
-- workspace fails to open rather than silently decrypting.

CREATE TYPE credential_type AS ENUM ('bearer', 'header', 'basic');

CREATE TABLE workspace_credentials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  type         credential_type NOT NULL,
  -- Only meaningful for `header`. The other two derive their header name from
  -- the scheme, so storing it would invite two sources of truth.
  header_name  text,
  last_used_at timestamptz,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- A workflow node stores a credential id, but a person picking one from a list
-- reads the name. Two credentials called "Stripe" in one workspace would make
-- that list a guess, so the name is unique per workspace.
CREATE UNIQUE INDEX workspace_credentials_workspace_name_idx
  ON workspace_credentials(workspace_id, lower(name));
CREATE INDEX workspace_credentials_workspace_created_idx
  ON workspace_credentials(workspace_id, created_at DESC);

-- A `header` credential without a header name is unusable, and the other kinds
-- must not carry one: the CHECK keeps the two columns from disagreeing.
ALTER TABLE workspace_credentials
  ADD CONSTRAINT workspace_credentials_header_name_check
  CHECK (
    (type = 'header' AND header_name IS NOT NULL AND length(btrim(header_name)) > 0)
    OR (type <> 'header' AND header_name IS NULL)
  );

CREATE TRIGGER workspace_credentials_set_updated_at
  BEFORE UPDATE ON workspace_credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE workspace_credential_secrets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL REFERENCES workspace_credentials(id) ON DELETE CASCADE,
  ciphertext    text NOT NULL,
  iv            text NOT NULL,
  tag           text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One envelope per credential: every field is sealed together, so replacing one
-- rewrites the row.
CREATE UNIQUE INDEX workspace_credential_secrets_credential_idx
  ON workspace_credential_secrets(credential_id);
CREATE INDEX workspace_credential_secrets_workspace_idx
  ON workspace_credential_secrets(workspace_id);

CREATE TRIGGER workspace_credential_secrets_set_updated_at
  BEFORE UPDATE ON workspace_credential_secrets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE workspace_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_credentials_workspace_isolation ON workspace_credentials
  USING (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  WITH CHECK (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

ALTER TABLE workspace_credential_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_credential_secrets FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_credential_secrets_workspace_isolation ON workspace_credential_secrets
  USING (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  WITH CHECK (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );
