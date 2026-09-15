import "server-only";

import { eq, lte, sql } from "drizzle-orm";

import { query, withDb } from "@/server/db/client";
import { concurrencyLeases, rateLimitBuckets } from "@/server/db/schema";

/**
 * The authoritative store behind every limit.
 *
 * Declared as an interface with a PostgreSQL implementation behind it, for one
 * reason: `docs/abuse-prevention-gate.md` §3 chose PostgreSQL over Redis on the
 * argument that the volumetric half of rate limiting is absorbed at the edge and
 * the identity-keyed remainder runs at tens of requests per second on paths that
 * already query the database. If measurement ever contradicts that, the swap is
 * this file and nothing else.
 *
 * Everything here is deliberately ignorant of what a key MEANS. It takes a hash
 * and returns a number. Key construction, policy and trust live in `keys.ts` and
 * `protect.ts`.
 */

export interface RateDecision {
  /** Count AFTER this request was charged. */
  count: number;
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface Lease {
  leaseId: string;
  slot: number;
}

export interface ProtectionStore {
  /** Charges one request against a fixed window and reports the result. */
  consume(input: { keyHash: string; scope: string; limit: number; windowMs: number; windowStartMs: number }): Promise<RateDecision>;
  /** Claims a slot, or returns null when every slot is held. */
  acquireLease(input: { keyHash: string; scope: string; limit: number; ttlMs: number }): Promise<Lease | null>;
  /** Idempotent: releasing an already-released or expired lease is a no-op. */
  releaseLease(leaseId: string): Promise<void>;
  /** Deletes rows whose window or lease has passed. Best effort, never on the critical path. */
  sweep(): Promise<void>;
}

/**
 * Claims the lowest free slot, reclaiming an expired one in the same statement.
 *
 * `generate_series(0, limit - 1)` enumerates the slots; `NOT EXISTS` skips the
 * ones currently held; `ORDER BY s LIMIT 1` takes the lowest free one. If two
 * callers pick the same slot simultaneously, the unique constraint sends the
 * loser into `DO UPDATE`, whose `WHERE` then refuses because the winner's lease
 * has NOT expired - so it returns no row and is refused. Conservative by
 * construction: the constraint makes over-allocation unrepresentable, and the
 * cost is a false rejection under exact contention.
 *
 * A reclaimed slot gets a NEW `lease_id`. Reusing the old one would let a
 * crashed holder's late release delete the lease that replaced it.
 *
 * Every time value is the database's own `now()`, on both sides of the
 * comparison, so instances with skewed clocks cannot disagree about whether a
 * lease is live.
 *
 * This one stays hand-written SQL. Three things in it have no builder form:
 * the INSERT draws its rows from `generate_series` in a FROM clause, the
 * conflict target is a NAMED CONSTRAINT rather than a column list, and the
 * `DO UPDATE` carries its own `WHERE` - which is precisely the part that makes
 * over-allocation impossible. Classified in `docs/drizzle-orm-migration-plan.md`.
 *
 * ── Why one attempt is not enough (measured) ────────────────────────────────
 *
 * Every caller picks the LOWEST free slot, so simultaneous callers all pick the
 * same one and all but one lose. Against PostgreSQL 17, twenty callers arriving
 * together on a limit of twenty filled only five slots - a 75% false-reject
 * rate at exactly the moment the capacity was free. Refusing work that the
 * limit permits is its own kind of wrong, so `acquireLease` retries: a caller
 * that lost a collision re-evaluates and finds the slot the winner did not
 * take. See `ACQUIRE_ATTEMPTS`.
 */
const ACQUIRE_SQL = `
  INSERT INTO concurrency_leases (scope_key, slot, scope, expires_at)
  SELECT $1, s, $2, now() + make_interval(secs => $3::double precision / 1000)
  FROM generate_series(0, $4::integer - 1) AS s
  WHERE NOT EXISTS (
    SELECT 1 FROM concurrency_leases held
    WHERE held.scope_key = $1 AND held.slot = s AND held.expires_at > now()
  )
  ORDER BY s
  LIMIT 1
  ON CONFLICT ON CONSTRAINT concurrency_leases_slot_unique
  DO UPDATE SET
    lease_id = gen_random_uuid(),
    scope = EXCLUDED.scope,
    acquired_at = now(),
    expires_at = EXCLUDED.expires_at
  WHERE concurrency_leases.expires_at <= now()
  RETURNING lease_id, slot
`;

/**
 * Attempts at claiming a slot before refusing.
 *
 * Bounded deliberately and kept small. When capacity is genuinely full, every
 * attempt is a wasted round trip on a request that will be refused anyway - so
 * this trades a little work at the moment of refusal for not refusing work the
 * limit actually allows.
 *
 * Measured against PostgreSQL 17, simultaneous callers on one key, share of
 * free capacity actually taken:
 *
 *   limit 20, 20 callers   25% → 80%
 *   limit 20, 25 callers   40% → 100%
 *   limit 10, 20 callers   100% → 100%   (already saturated; retries change nothing)
 *
 * Over-allocation never occurred at either setting, which is the point: the
 * unique constraint is what holds the limit, and retrying only recovers
 * capacity that was being left on the floor. Three is where the return flattens;
 * a larger number mostly buys latency on the refusal path.
 */
const ACQUIRE_ATTEMPTS = 3;

export const postgresProtectionStore: ProtectionStore = {
  /**
   * Atomic in ONE statement, which is the whole requirement.
   *
   * The naive form - SELECT the count, add one in the application, UPDATE -
   * loses increments whenever two requests interleave, and "loses increments"
   * on a rate limiter means "lets requests through". `INSERT … ON CONFLICT DO
   * UPDATE … RETURNING` performs the read, the increment and the write under
   * one row lock, so a caller cannot win a race against itself no matter how
   * many instances it is spread across.
   *
   * `window_start` arrives pre-computed and aligned from `windowStartMs()`, so
   * two instances derive the same row without agreeing on anything first.
   *
   * Only `count` is touched on conflict. `expires_at` keeps the value the first
   * request of the window wrote, so a busy window cannot push its own expiry
   * forward and outlive the window it belongs to.
   */
  async consume({ keyHash, scope, limit, windowMs, windowStartMs }) {
    const expiresAtMs = windowStartMs + windowMs;
    const rows = await withDb((db) =>
      db
        .insert(rateLimitBuckets)
        .values({
          keyHash,
          windowStart: new Date(windowStartMs),
          scope,
          count: 1,
          expiresAt: new Date(expiresAtMs),
        })
        .onConflictDoUpdate({
          target: [rateLimitBuckets.keyHash, rateLimitBuckets.windowStart],
          // The increment is computed by the database under the row lock the
          // upsert already holds, never read into the application and sent back.
          set: { count: sql`${rateLimitBuckets.count} + 1` },
        })
        .returning({ count: rateLimitBuckets.count }),
    );
    const count = Number(rows[0]?.count ?? 0);
    return {
      count,
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 1000)),
    };
  },

  async acquireLease({ keyHash, scope, limit, ttlMs }) {
    if (limit <= 0) return null;

    for (let attempt = 0; attempt < ACQUIRE_ATTEMPTS; attempt++) {
      const rows = await query<{ lease_id: string; slot: number }>(ACQUIRE_SQL, [keyHash, scope, ttlMs, limit]);
      const row = rows[0];
      if (row) return { leaseId: row.lease_id, slot: row.slot };
      // A single slot has no second slot to fall back to, so a retry can only
      // re-lose the same race. Everything else gets another look.
      if (limit === 1) break;
    }
    return null;
  },

  async releaseLease(leaseId) {
    await withDb((db) => db.delete(concurrencyLeases).where(eq(concurrencyLeases.leaseId, leaseId)));
  },

  async sweep() {
    // `now()` on both sides, like every other comparison here: the sweep must
    // agree with the acquire path about which leases are still live.
    await withDb((db) => db.delete(rateLimitBuckets).where(lte(rateLimitBuckets.expiresAt, sql`now()`)));
    await withDb((db) => db.delete(concurrencyLeases).where(lte(concurrencyLeases.expiresAt, sql`now()`)));
  },
};
