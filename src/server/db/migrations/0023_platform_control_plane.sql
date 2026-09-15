-- 0023_platform_control_plane
--
-- Introduces the PLATFORM plane: the boundary the platform operator works
-- inside, as distinct from the customer organizations they operate for.
--
-- Everything here is deliberately OUTSIDE tenancy.
--
--   * No table below has a `workspace_id`, so none of them is covered by the
--     `*_workspace_isolation` policies, and `tests/unit/rls.integration.test.ts`
--     (which enumerates tables by that column) correctly does not require one.
--     They sit in the same class as `users`, `organizations`, `workspaces`,
--     `sessions` and `organization_members`: global, and guarded by the service
--     layer rather than by Row Level Security.
--   * `platform_audit_log` has no workspace reference ON PURPOSE. A platform
--     action - disabling a provider, flipping a flag, suspending a tenant - has
--     no workspace to belong to, and a foreign key to `workspaces` would let a
--     customer deletion cascade away the operator's own audit trail. That the
--     record outlives its subject is the reason the table exists separately
--     from `activity_log` rather than reusing it.
--
-- Both status columns added to existing tables default to the value every
-- current row already effectively has, so this migration changes no observable
-- behaviour for any existing user, organization or session until an operator
-- takes an explicit action.

-- ---------------------------------------------------------------------------
-- Platform administrators
-- ---------------------------------------------------------------------------
--
-- A platform admin is NOT an organization role. There is no path from
-- `organization_members.role` to this table: holding `owner` on every
-- organization in the database grants nothing here. Membership is granted out
-- of band by `scripts/grant-platform-admin.mjs`, never through an HTTP route,
-- which is what keeps the boundary from being reachable by a request at all.
--
-- Revocation is a timestamp rather than a DELETE so that "who used to hold
-- this" stays answerable, matching `api_keys.revoked_at` and
-- `organization_invitations.revoked_at`.
CREATE TABLE platform_admins (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  note          text
);

-- The guard reads only live grants; this is the index that serves it.
CREATE INDEX platform_admins_active_idx ON platform_admins (user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Platform audit log
-- ---------------------------------------------------------------------------
--
-- Append-only record of privileged actions. `actor_email` is denormalized
-- beside `actor_id` precisely because `actor_id` is ON DELETE SET NULL: when an
-- operator's account is removed, the trail must still name who acted.
--
-- `target_id` is text, not uuid, because platform targets are not all rows -
-- a feature flag, a routing capability or a settings key is addressed by name.
--
-- NEVER write a credential, token, password or raw secret into `metadata`.
-- `tests/unit/platform-audit.test.ts` asserts the redaction helper that guards
-- this, and the service layer is the only writer.
CREATE TABLE platform_audit_log (
  id            bigserial PRIMARY KEY,
  actor_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email   citext,
  action        text NOT NULL,
  target_type   text NOT NULL,
  target_id     text,
  target_label  text,
  -- 'success' | 'denied' | 'error'. Denials are recorded too: an authenticated
  -- non-admin probing an /api/admin route is exactly the signal worth keeping.
  result        text NOT NULL DEFAULT 'success',
  metadata      jsonb NOT NULL DEFAULT '{}',
  ip_address    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platform_audit_log_created_idx ON platform_audit_log (created_at DESC);
CREATE INDEX platform_audit_log_actor_idx   ON platform_audit_log (actor_id, created_at DESC);
CREATE INDEX platform_audit_log_action_idx  ON platform_audit_log (action, created_at DESC);
CREATE INDEX platform_audit_log_target_idx  ON platform_audit_log (target_type, target_id);

-- ---------------------------------------------------------------------------
-- Organization lifecycle
-- ---------------------------------------------------------------------------
--
-- Three states, and no more than three. `suspended` is the reversible operator
-- action (billing failure, abuse investigation); `disabled` is the terminal one
-- that precedes deletion. Neither deletes customer data - suspension is an
-- access decision, not a retention decision.
CREATE TYPE organization_status AS ENUM ('active', 'suspended', 'disabled');

ALTER TABLE organizations
  ADD COLUMN status            organization_status NOT NULL DEFAULT 'active',
  ADD COLUMN status_reason     text,
  ADD COLUMN status_changed_at timestamptz;

-- Partial: the operator's Organizations list filters for what is NOT active,
-- which is the small side of a table dominated by healthy tenants.
CREATE INDEX organizations_status_idx ON organizations (status) WHERE status <> 'active';

-- ---------------------------------------------------------------------------
-- User lifecycle
-- ---------------------------------------------------------------------------
--
-- A timestamp rather than a boolean, for the same reason as the revocations
-- above: "disabled" and "disabled since Tuesday" are the same column.
--
-- Disabling does not delete the account, its memberships or its content. It
-- stops the account authenticating; `disableUser` additionally deletes the
-- user's sessions so the change takes effect on the next request rather than
-- whenever the current session happens to expire.
ALTER TABLE users
  ADD COLUMN disabled_at     timestamptz,
  ADD COLUMN disabled_reason text;

CREATE INDEX users_disabled_idx ON users (disabled_at) WHERE disabled_at IS NOT NULL;
