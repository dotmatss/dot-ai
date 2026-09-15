-- 0028_billing
--
-- Binds a workspace to a plan from the catalogue in `src/features/pricing`, so
-- that "which plan is this workspace on" has an answer in the database rather
-- than in a constant. This is the billing layer `src/features/pricing/types.ts`
-- was shaped for: a plan states a limit per `EntitlementKey`, and the service
-- over this table answers "may this workspace do X" against the same keys.
--
-- WHAT THIS IS NOT
-- ----------------
-- Not a payment system. There is no processor, no customer id, no card, no
-- invoice and no price. `PlanPrice` still has no `amount` field, deliberately,
-- and every plan in the catalogue is still `status: 'draft'`. This table
-- records an ASSIGNMENT - somebody decided this workspace is on this plan -
-- and nothing about money. When a processor arrives it adds its own columns
-- (or its own table) and this one keeps meaning what it means today.
--
-- WHY THERE IS NO BACKFILL, AND NO DEFAULT PLAN
-- ---------------------------------------------
-- The obvious move is to give every existing workspace a row for the free
-- tier. It would be wrong here, and not by a small margin: `starter` declares
-- `apiAccess: 'unavailable'` and `integrations: 'unavailable'`, so a backfill
-- to starter would revoke the developer API and every outbound integration
-- from every workspace that already uses them, at the moment this migration
-- ran.
--
-- So a workspace with no row is UNASSIGNED, which is its own state and not a
-- synonym for the cheapest plan. Nothing is enforced against an unassigned
-- workspace, and the UI says exactly that rather than implying a tier nobody
-- chose. Enforcement begins when an owner assigns a plan, which is a visible,
-- deliberate act with an activity-log entry behind it.
--
-- WHY `plan_id` IS TEXT AND NOT AN ENUM
-- -------------------------------------
-- The catalogue lives in TypeScript (`src/features/pricing/plans.ts`) and is
-- expected to change while pricing is being decided. An enum would turn every
-- rename into a migration, and a foreign key would need the catalogue to be a
-- table - which would move the pricing model out of the file that is currently
-- the single place it is edited. The service validates `plan_id` against the
-- catalogue on write and degrades safely on read: an id that no longer exists
-- reports as unknown instead of throwing, so deleting a plan cannot take a
-- workspace's settings page down with it.

CREATE TYPE subscription_status AS ENUM ('active', 'trialing', 'past_due', 'canceled');

CREATE TABLE workspace_subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- An id from `PLANS` in src/features/pricing/plans.ts. Validated on write.
  plan_id                text NOT NULL,
  status                 subscription_status NOT NULL DEFAULT 'active',
  -- The window metered entitlements (messages, tokens, workflow runs) are
  -- counted over. Stored rather than derived because a billing period is a
  -- property of the agreement, not of the calendar: an unassigned workspace
  -- falls back to a calendar month, an assigned one uses what is written here.
  current_period_start   timestamptz NOT NULL DEFAULT now(),
  current_period_end     timestamptz NOT NULL,
  -- Recorded so the UI can say "ends on <date>" instead of "cancelled" while
  -- the workspace still has the plan it paid for. Nothing expires it
  -- automatically; there is no scheduler here yet and pretending otherwise
  -- would be worse than saying so.
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  assigned_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- One subscription per workspace. Two rows would make "which plan is this
-- workspace on" a question with two answers, and every entitlement check would
-- have to pick one.
CREATE UNIQUE INDEX workspace_subscriptions_workspace_idx
  ON workspace_subscriptions(workspace_id);

-- A period that ends before it starts would make every metered window empty,
-- so the entitlement service would silently report zero usage against a real
-- allowance. Rejected at the column rather than in one code path.
ALTER TABLE workspace_subscriptions
  ADD CONSTRAINT workspace_subscriptions_period_check
  CHECK (current_period_end > current_period_start);

ALTER TABLE workspace_subscriptions
  ADD CONSTRAINT workspace_subscriptions_plan_id_check
  CHECK (length(btrim(plan_id)) > 0);

CREATE TRIGGER workspace_subscriptions_set_updated_at
  BEFORE UPDATE ON workspace_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE workspace_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_subscriptions_workspace_isolation ON workspace_subscriptions
  USING (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  WITH CHECK (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );
