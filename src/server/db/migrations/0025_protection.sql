-- 0025_protection
--
-- The shared substrate for abuse prevention: rate-limit counters and
-- concurrency leases that every application instance agrees on.
--
-- WHY THIS TABLE EXISTS AT ALL
-- ---------------------------
-- `src/server/http/rate-limit.ts` keeps its counters in a per-process `Map`.
-- Behind more than one instance the effective ceiling is multiplied by the
-- instance count, which makes every limit the product documents advisory
-- rather than binding. See `docs/abuse-prevention-gate.md` §2 and §3 for why
-- PostgreSQL was chosen over Redis: quotas are durable accounting that must
-- reconcile against `usage_events`, concurrency is a lease, and the volumetric
-- half of rate limiting is absorbed by Cloudflare rules at the edge.
--
-- NO `workspace_id`, DELIBERATELY
-- -------------------------------
-- Both tables sit in the same class as `platform_admins` and
-- `platform_audit_log` (migration 0023): global operational state, guarded by
-- the service layer rather than by Row Level Security.
--
-- Three reasons, and the first is the one that matters:
--
--   1. A limit is consulted BEFORE a tenant context exists. The public API
--      resolves its workspace from an API key hash, and the widget from an
--      embed key - both AFTER the point where a flood has to be refused. A
--      column that cannot be populated at the moment of use is not a boundary,
--      it is decoration.
--   2. These rows are ephemeral. A bucket outlives its window by minutes and a
--      lease by seconds, so orphaned rows are self-cleaning and the cascade a
--      foreign key would provide buys nothing.
--   3. `tests/unit/rls.integration.test.ts` enumerates tenant tables by the
--      presence of a `workspace_id` column. Adding one here would demand an
--      isolation policy for state that carries no tenant content - no message,
--      no prompt, no credential, not even an address. What it holds is a hash
--      and an integer.
--
-- Tenant separation is instead a property of the KEY: `buildKey()` in
-- `src/server/protection/keys.ts` derives every key from server-resolved
-- identity, so one workspace cannot address another's counter. That is the
-- same argument `api_keys` relies on, one layer up.
--
-- NOTHING READS THESE TABLES YET. Phase 1 is the foundation; the existing
-- in-process limiter is untouched and every current call site behaves exactly
-- as it did. Wiring happens per surface in phases 2-5.

-- ---------------------------------------------------------------------------
-- Rate-limit buckets
-- ---------------------------------------------------------------------------
--
-- Fixed windows, aligned to absolute time: `window_start` is
-- floor(epoch_ms / window_ms) * window_ms. Alignment is what makes the counter
-- shareable - two instances handling the same caller in the same second derive
-- the same `window_start` without coordinating, so they increment one row.
--
-- It also makes the in-process pre-filter provably sound. Because both layers
-- key on the same aligned window, the local count for a window can never
-- exceed the global count for that window, so a local rejection is always a
-- rejection the authority would also make. The pre-filter may therefore refuse
-- without asking, and may never allow without asking.
--
-- `key_hash` is a SHA-256 of the full key, never the key itself. Keys contain
-- email addresses and client addresses; this table is operational telemetry and
-- has no business holding either. `scope` is the coarse, non-identifying label
-- ('sign-in', 'public-api') kept so an operator can see WHICH protection is
-- firing without seeing WHO it fired on.
CREATE TABLE rate_limit_buckets (
  key_hash      text        NOT NULL,
  -- Truncated to the window, so this is a value both instances compute, never
  -- one they negotiate.
  window_start  timestamptz NOT NULL,
  scope         text        NOT NULL,
  count         bigint      NOT NULL DEFAULT 1,
  expires_at    timestamptz NOT NULL,
  PRIMARY KEY (key_hash, window_start)
);

-- Serves the sweep, which deletes whole expired windows.
CREATE INDEX rate_limit_buckets_expiry_idx ON rate_limit_buckets (expires_at);

-- ---------------------------------------------------------------------------
-- Concurrency leases
-- ---------------------------------------------------------------------------
--
-- "How many of these may run AT ONCE", which no rate limit can express: ten
-- requests per minute is not a statement about how many are in flight.
--
-- SLOTS, NOT A COUNTER
-- --------------------
-- The obvious implementation - count the rows, insert if under the limit - is
-- wrong under READ COMMITTED. Two transactions both read a count of 9 against a
-- limit of 10 and both insert, and the limit silently becomes 11. Raising the
-- isolation level or taking an advisory lock would fix it at the cost of
-- serialising every acquisition.
--
-- Instead each holder claims a numbered slot in `[0, limit)`, and
-- `UNIQUE (scope_key, slot)` makes over-allocation UNREPRESENTABLE rather than
-- merely unlikely: at most `limit` live rows can exist for a scope, whatever
-- the interleaving, because the database refuses the second one.
--
-- The cost is on the other side, and it was measured rather than assumed: every
-- caller picks the LOWEST free slot, so simultaneous callers collide on it and
-- all but one lose. Twenty callers arriving together on a limit of twenty filled
-- only five slots - work refused at the exact moment the capacity was free.
--
-- `acquireLease` therefore retries a bounded number of times, which takes that
-- to 80-100% without ever over-allocating, because it is the constraint and not
-- the retry count that holds the limit. See `ACQUIRE_ATTEMPTS` in
-- `src/server/protection/store.ts` for the measurements.
--
-- EXPIRY IS THE CRASH-SAFETY STORY
-- --------------------------------
-- A process that dies mid-work releases nothing. Every lease therefore carries
-- an absolute `expires_at` and a slot is reclaimable once past it, so a crash
-- costs one slot until the lease would have ended anyway - not a workspace
-- wedged forever. The reclaim happens as part of the atomic acquisition, so no
-- separate reaper is required for correctness.
CREATE TABLE concurrency_leases (
  lease_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The protection key this lease is counted against, hashed like above.
  scope_key   text        NOT NULL,
  slot        integer     NOT NULL,
  scope       text        NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  CONSTRAINT concurrency_leases_slot_unique UNIQUE (scope_key, slot),
  CONSTRAINT concurrency_leases_slot_non_negative CHECK (slot >= 0)
);

-- Serves both the "is this slot free" test during acquisition and the sweep.
CREATE INDEX concurrency_leases_expiry_idx ON concurrency_leases (expires_at);
