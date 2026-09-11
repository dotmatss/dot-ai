-- 0011_integrations
--
-- Integration credentials.
--
-- `integrations.config` holds only values that are safe to return to the
-- browser. Anything secret (a signing secret, an SMTP password, a Slack
-- incoming-webhook URL) is encrypted with AES-256-GCM by
-- src/features/integrations/server/secret-box.ts and stored here; the
-- integration row points at it through `secret_ref`. Splitting the tables
-- keeps ciphertext out of every list query and makes "which routes can read a
-- secret" answerable by grepping for this table.

CREATE TABLE integration_secrets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  ciphertext     text NOT NULL,
  iv             text NOT NULL,
  tag            text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One sealed envelope per integration: every secret field for a provider is
-- encrypted together, so replacing one field rewrites the row.
CREATE UNIQUE INDEX integration_secrets_integration_idx ON integration_secrets(integration_id);
CREATE INDEX integration_secrets_workspace_idx ON integration_secrets(workspace_id);

CREATE TRIGGER integration_secrets_set_updated_at
  BEFORE UPDATE ON integration_secrets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Result of the last server-side connection test. Kept in columns rather than
-- in `config` so the provider config stays exactly what the registry schema
-- validates, and so a failed test cannot be confused with configuration.
ALTER TABLE integrations
  ADD COLUMN last_test_at      timestamptz,
  ADD COLUMN last_test_ok      boolean,
  ADD COLUMN last_test_message text;

-- api_keys are looked up by hash on every public API request; the UNIQUE
-- constraint on key_hash already provides that index. This one keeps the
-- workspace listing ordered without a sort.
CREATE INDEX api_keys_workspace_created_idx ON api_keys(workspace_id, created_at DESC);

ALTER TABLE integration_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_secrets FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_secrets_workspace_isolation ON integration_secrets
  USING (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  WITH CHECK (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );
