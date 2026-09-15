-- 0019_invitations
--
-- Adding people to an organization.
--
-- Until now the only way into an organization was to create one at sign-up, so
-- a second person could only be added by writing an `organization_members` row
-- by hand. This is the missing half: a pending invitation that a person can
-- accept, with the membership row created only at that moment.
--
-- WHY THE TOKEN IS NOT STORED
-- ---------------------------
-- The invitation link carries a random token; the table keeps only its SHA-256
-- hash, exactly like `sessions.token_hash`. A database dump therefore contains
-- nothing that can be used to join an organization, and a lookup is still one
-- indexed equality on the hash.
--
-- NO ROW LEVEL SECURITY, AND WHY
-- ------------------------------
-- Membership is held at the organization level: `organization_members` has no
-- `workspace_id` and neither does this table, so neither is covered by the
-- `*_workspace_isolation` policies. The boundary for both is re-established in
-- `src/features/settings/server/settings-service.ts`, which only ever filters
-- by the organization id that `requireWorkspaceAccess` resolved for the caller.
-- `tests/unit/rls.integration.test.ts` discovers tenant tables by the presence
-- of a `workspace_id` column, so this table is correctly outside its sweep.
--
-- THREE TERMINAL STATES, NOT A STATUS COLUMN
-- ------------------------------------------
-- accepted, revoked and expired are recorded as `accepted_at`, `revoked_at` and
-- `expires_at` rather than an enum, because each one answers "when" as well as
-- "what", and because expiry has to be a comparison against now() regardless -
-- a status column would need a job to keep it true.

CREATE TABLE organization_invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- citext, so an invitation to Sam@example.com is found by sam@example.com.
  -- Matches `users.email`, which is how acceptance is bound to one account.
  email            citext NOT NULL,
  role             member_role NOT NULL DEFAULT 'member',

  -- SHA-256 of the token in the link. Unique because a collision is either a
  -- replay or a bug, and both should fail rather than resolve to a row.
  token_hash       text NOT NULL UNIQUE,

  invited_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at       timestamptz NOT NULL,

  accepted_at      timestamptz,
  accepted_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- An accepted invitation must say who accepted it; anything else is a row
  -- that cannot be explained later.
  CONSTRAINT organization_invitations_accepted_by_present
    CHECK ((accepted_at IS NULL) = (accepted_by IS NULL))
);

-- At most one live invitation per address per organization. Partial, so the
-- history of superseded invitations to the same person is kept: re-inviting
-- after a revoke is normal and must not collide with the revoked row.
CREATE UNIQUE INDEX organization_invitations_pending_email_idx
  ON organization_invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- The list on the Members tab: newest first within one organization.
CREATE INDEX organization_invitations_organization_idx
  ON organization_invitations (organization_id, created_at DESC);
