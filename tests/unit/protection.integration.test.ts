// @vitest-environment node
/**
 * The protection substrate against a real PostgreSQL.
 *
 * The policy logic is unit-tested with a stub store. What needs a database is
 * the half that cannot be faked, because the claims are about CONCURRENCY:
 *
 *   - increments are not lost when requests interleave, which on a rate limiter
 *     is the difference between a ceiling and a suggestion;
 *   - instances share one counter, which is the entire reason this exists;
 *   - a concurrency limit cannot be exceeded by racing, because the constraint
 *     makes over-allocation unrepresentable rather than unlikely;
 *   - a crashed holder's slot comes back.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:5433/dot_dev" pnpm exec vitest run protection.integration
 *
 * Skipped when DATABASE_URL is absent, so the default suite stays hermetic.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { windowStartMs } from "@/server/protection/keys";
import { postgresProtectionStore as store } from "@/server/protection/store";

const connectionString = process.env.DATABASE_URL;
const suffix = Math.random().toString(36).slice(2, 10);

let admin: pg.Client;

/** Unique per test, so parallel files cannot collide on a bucket or a slot. */
let seq = 0;
function uniqueHash(label: string): string {
  seq += 1;
  return `test-${suffix}-${label}-${seq}`;
}

describe.skipIf(!connectionString)("protection substrate", () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString });
    await admin.connect();
  });

  afterAll(async () => {
    await admin.query("DELETE FROM rate_limit_buckets WHERE key_hash LIKE $1", [`test-${suffix}-%`]);
    await admin.query("DELETE FROM concurrency_leases WHERE scope_key LIKE $1", [`test-${suffix}-%`]);
    await admin.end();
  });

  describe("rate limit buckets", () => {
    it("counts sequential requests and refuses past the ceiling", async () => {
      const keyHash = uniqueHash("seq");
      const args = { keyHash, scope: "test", limit: 3, windowMs: 60_000, windowStartMs: windowStartMs(Date.now(), 60_000) };

      const results = [];
      for (let i = 0; i < 5; i++) results.push(await store.consume(args));

      expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
      expect(results.map((r) => r.count)).toEqual([1, 2, 3, 4, 5]);
      expect(results[2]!.remaining).toBe(0);
    });

    it("loses no increment when requests interleave", async () => {
      const keyHash = uniqueHash("race");
      const args = { keyHash, scope: "test", limit: 10, windowMs: 60_000, windowStartMs: windowStartMs(Date.now(), 60_000) };

      // The test that a read-modify-write implementation fails: fifty callers
      // arriving at once must produce exactly fifty increments, not "about"
      // fifty. A lost increment on a limiter lets a request through.
      const outcomes = await Promise.all(Array.from({ length: 50 }, () => store.consume(args)));

      expect(outcomes).toHaveLength(50);
      // Every count is distinct and they cover 1..50 exactly.
      expect([...new Set(outcomes.map((o) => o.count))].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 50 }, (_, i) => i + 1),
      );
      // Exactly the ceiling was allowed through, no more.
      expect(outcomes.filter((o) => o.allowed)).toHaveLength(10);
    });

    it("shares one counter across instances", async () => {
      const keyHash = uniqueHash("shared");
      const args = { keyHash, scope: "test", limit: 2, windowMs: 60_000, windowStartMs: windowStartMs(Date.now(), 60_000) };

      // Each direct call to the store is what a SEPARATE instance looks like:
      // its own process, its own in-memory map, no pre-filter in the way. The
      // shared row is the only thing they have in common, and it is enough.
      const instanceA = await store.consume(args);
      const instanceB = await store.consume(args);
      const instanceC = await store.consume(args);

      expect([instanceA.allowed, instanceB.allowed, instanceC.allowed]).toEqual([true, true, false]);
    });

    it("starts a fresh bucket in the next window", async () => {
      const keyHash = uniqueHash("window");
      const windowMs = 60_000;
      const first = windowStartMs(Date.now(), windowMs);
      const base = { keyHash, scope: "test", limit: 1, windowMs };

      expect((await store.consume({ ...base, windowStartMs: first })).allowed).toBe(true);
      expect((await store.consume({ ...base, windowStartMs: first })).allowed).toBe(false);
      // A different window is a different row, so the ceiling resets without
      // anything having to reset it.
      expect((await store.consume({ ...base, windowStartMs: first + windowMs })).allowed).toBe(true);
    });

    it("keeps one key's counter out of another's", async () => {
      const windowStart = windowStartMs(Date.now(), 60_000);
      const base = { scope: "test", limit: 1, windowMs: 60_000, windowStartMs: windowStart };

      expect((await store.consume({ ...base, keyHash: uniqueHash("tenant-a") })).allowed).toBe(true);
      // A different tenant's first request is its own first request.
      expect((await store.consume({ ...base, keyHash: uniqueHash("tenant-b") })).allowed).toBe(true);
    });

    it("stores no identifier, only a hash and a scope", async () => {
      const keyHash = uniqueHash("columns");
      await store.consume({ keyHash, scope: "sign-in", limit: 5, windowMs: 60_000, windowStartMs: windowStartMs(Date.now(), 60_000) });

      const { rows } = await admin.query<Record<string, unknown>>("SELECT * FROM rate_limit_buckets WHERE key_hash = $1", [keyHash]);
      // The whole row is a hash, a coarse label, a window and an integer. There
      // is nowhere for an address or an email to be.
      expect(Object.keys(rows[0]!).sort()).toEqual(["count", "expires_at", "key_hash", "scope", "window_start"]);
      expect(rows[0]!.scope).toBe("sign-in");
    });
  });

  describe("concurrency leases", () => {
    it("hands out distinct slots up to the limit", async () => {
      const keyHash = uniqueHash("slots");
      const args = { keyHash, scope: "test", limit: 3, ttlMs: 30_000 };

      const leases = [await store.acquireLease(args), await store.acquireLease(args), await store.acquireLease(args)];
      expect(leases.every(Boolean)).toBe(true);
      expect(new Set(leases.map((l) => l!.slot)).size).toBe(3);

      // Every slot is held, so the fourth caller is refused rather than queued.
      expect(await store.acquireLease(args)).toBeNull();
    });

    it("cannot be raced past its limit", async () => {
      const keyHash = uniqueHash("lease-race");
      const args = { keyHash, scope: "test", limit: 4, ttlMs: 30_000 };

      const results = await Promise.all(Array.from({ length: 30 }, () => store.acquireLease(args)));
      const granted = results.filter((r): r is NonNullable<typeof r> => r !== null);

      // THE safety property: the unique constraint is what guarantees this, not
      // the count-then-insert that READ COMMITTED would happily let through
      // twice. Nothing below matters if this line ever fails.
      expect(granted.length).toBeLessThanOrEqual(4);
      expect(new Set(granted.map((l) => l.slot)).size).toBe(granted.length);

      // And the liveness property the retry exists for: with callers far
      // exceeding slots, every slot should actually get taken. A limiter that
      // refuses work while capacity sits free is its own kind of broken.
      expect(granted.length).toBe(4);

      const { rows } = await admin.query<{ n: string }>(
        "SELECT count(*) AS n FROM concurrency_leases WHERE scope_key = $1 AND expires_at > now()",
        [keyHash],
      );
      expect(Number(rows[0]!.n)).toBeLessThanOrEqual(4);
    });

    it("frees the slot on release", async () => {
      const keyHash = uniqueHash("release");
      const args = { keyHash, scope: "test", limit: 1, ttlMs: 30_000 };

      const lease = await store.acquireLease(args);
      expect(await store.acquireLease(args)).toBeNull();

      await store.releaseLease(lease!.leaseId);
      expect(await store.acquireLease(args)).not.toBeNull();
    });

    it("treats releasing an unknown lease as a no-op", async () => {
      // A release can arrive twice, or after the lease already expired and was
      // reclaimed. Neither may throw and neither may touch the current holder.
      await expect(store.releaseLease("00000000-0000-4000-8000-000000000000")).resolves.toBeUndefined();
    });

    it("reclaims the slot of a holder that never released it", async () => {
      const keyHash = uniqueHash("crash");
      // A lease that has already expired stands in for a process that died
      // mid-work: nothing released it, and nothing is going to.
      const expired = { keyHash, scope: "test", limit: 1, ttlMs: 1 };

      const lease = await store.acquireLease(expired);
      expect(lease).not.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const reclaimed = await store.acquireLease({ keyHash, scope: "test", limit: 1, ttlMs: 30_000 });
      expect(reclaimed).not.toBeNull();
      // A new lease id, so the crashed holder's late release cannot delete the
      // lease that replaced it.
      expect(reclaimed!.leaseId).not.toBe(lease!.leaseId);
      expect(reclaimed!.slot).toBe(lease!.slot);

      await store.releaseLease(lease!.leaseId);
      const { rows } = await admin.query<{ n: string }>("SELECT count(*) AS n FROM concurrency_leases WHERE scope_key = $1", [keyHash]);
      expect(Number(rows[0]!.n)).toBe(1);
    });

    it("refuses everything when the limit is zero", async () => {
      expect(await store.acquireLease({ keyHash: uniqueHash("zero"), scope: "test", limit: 0, ttlMs: 30_000 })).toBeNull();
    });
  });

  describe("sweep", () => {
    it("removes expired rows and leaves live ones alone", async () => {
      const expiredHash = uniqueHash("sweep-old");
      const liveHash = uniqueHash("sweep-live");
      const windowMs = 60_000;

      // One bucket whose window closed an hour ago, one in the current window.
      await store.consume({ keyHash: expiredHash, scope: "test", limit: 5, windowMs, windowStartMs: Date.now() - 3_600_000 });
      await store.consume({ keyHash: liveHash, scope: "test", limit: 5, windowMs, windowStartMs: windowStartMs(Date.now(), windowMs) });
      await store.acquireLease({ keyHash: expiredHash, scope: "test", limit: 1, ttlMs: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      await store.sweep();

      const buckets = await admin.query("SELECT 1 FROM rate_limit_buckets WHERE key_hash = $1", [expiredHash]);
      const live = await admin.query("SELECT 1 FROM rate_limit_buckets WHERE key_hash = $1", [liveHash]);
      const leases = await admin.query("SELECT 1 FROM concurrency_leases WHERE scope_key = $1", [expiredHash]);

      expect(buckets.rowCount).toBe(0);
      expect(leases.rowCount).toBe(0);
      // Sweeping is housekeeping; it must never shorten a window that is still open.
      expect(live.rowCount).toBe(1);
    });
  });
});
