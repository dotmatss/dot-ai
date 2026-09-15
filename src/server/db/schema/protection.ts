import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * The abuse-prevention substrate (migration 0025).
 *
 * Describes what the database already holds; the migration owns the
 * definitions and the reasoning. Like the control-plane and AI-registry tables,
 * neither of these carries a `workspace_id`: they are global operational state,
 * not tenant content, and tenant separation is a property of the KEY rather
 * than of a row. Migration 0025 states the full argument.
 *
 * Neither table holds a key, an address, an email or any request content - only
 * a SHA-256 of the key, a coarse scope label and an integer.
 */

/**
 * Fixed-window rate-limit counters, shared by every application instance.
 *
 * `windowStart` is aligned to absolute time (floor(epoch / window) * window),
 * which is what lets two instances increment the same row without coordinating.
 */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    /** SHA-256 of the full protection key. Never the key itself. */
    keyHash: text("key_hash").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    /** Coarse, non-identifying label: 'sign-in', 'public-api'. For operators. */
    scope: text("scope").notNull(),
    // Written as SQL rather than a numeric literal for the same reason
    // `usage_events.quantity` is: drizzle-kit serialises the schema to JSON to
    // diff it, and a bigint default has to survive that round trip.
    count: bigint("count", { mode: "number" })
      .notNull()
      .default(sql`1`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.keyHash, table.windowStart] }),
    index("rate_limit_buckets_expiry_idx").on(table.expiresAt),
  ],
);

/**
 * Live concurrency leases, one row per slot held.
 *
 * The unique constraint on `(scope_key, slot)` is the control: it makes
 * exceeding a limit unrepresentable rather than unlikely, which a
 * count-then-insert cannot do under READ COMMITTED. See migration 0025.
 */
export const concurrencyLeases = pgTable(
  "concurrency_leases",
  {
    leaseId: uuid("lease_id").primaryKey().defaultRandom(),
    /** SHA-256 of the protection key this lease is counted against. */
    scopeKey: text("scope_key").notNull(),
    /** The claimed slot in `[0, limit)`. */
    slot: integer("slot").notNull(),
    scope: text("scope").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
    /** Absolute. A crashed holder costs one slot until here, never forever. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("concurrency_leases_slot_unique").on(table.scopeKey, table.slot),
    index("concurrency_leases_expiry_idx").on(table.expiresAt),
    check("concurrency_leases_slot_non_negative", sql`slot >= 0`),
  ],
);
