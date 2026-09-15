// @vitest-environment node
/**
 * The decision `protect()` makes, against a stub store.
 *
 * These are mostly refusals, because each one is a rule something else relies
 * on. The properties worth stating plainly:
 *
 *   - evaluation stops at the FIRST rejection, which is why ordering is
 *     enforced rather than documented;
 *   - the in-process pre-filter may reject without asking the store, and may
 *     never allow without asking it;
 *   - what happens when the store itself is down is a per-call decision, and
 *     omitting it is a type error rather than an inherited default.
 *
 * The store is stubbed so this runs without a database; the SQL it stands in
 * for is exercised by `protection.integration.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/api-error";
import type { ProtectionKey } from "@/server/protection/keys";
import { protect, toProtectionError, withConcurrencyLease, type RateLimitRule } from "@/server/protection/protect";
import type { ProtectionStore } from "@/server/protection/store";

/** Unique per test, so the module-level pre-filter map cannot leak between them. */
let seq = 0;
function uniqueId(label: string): string {
  seq += 1;
  return `${label}-${seq}-${Math.random().toString(36).slice(2)}`;
}

function workspaceRule(limit: number, overrides: Partial<RateLimitRule> = {}): RateLimitRule {
  return {
    key: { scope: "public-api", dimension: "workspace", id: uniqueId("ws") },
    limit,
    windowMs: 60_000,
    ...overrides,
  };
}

/** Counts calls, and lets a test decide what the authority says. */
function stubStore(overrides: Partial<ProtectionStore> = {}) {
  const counts = new Map<string, number>();
  const calls = { consume: 0, acquire: 0, release: 0 };
  const store: ProtectionStore = {
    async consume({ keyHash, limit, windowMs, windowStartMs }) {
      calls.consume += 1;
      const bucket = `${keyHash}:${windowStartMs}`;
      const count = (counts.get(bucket) ?? 0) + 1;
      counts.set(bucket, count);
      return {
        count,
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      };
    },
    async acquireLease() {
      calls.acquire += 1;
      return { leaseId: "lease-1", slot: 0 };
    },
    async releaseLease() {
      calls.release += 1;
    },
    async sweep() {},
    ...overrides,
  };
  return { store, calls };
}

describe("protect", () => {
  it("allows requests below the ceiling", async () => {
    const { store } = stubStore();
    const rule = workspaceRule(3);

    for (let i = 0; i < 3; i++) {
      expect(await protect({ context: "t", limits: [rule], onStoreFailure: "closed", store })).toEqual({ allowed: true });
    }
  });

  it("refuses the request that crosses the ceiling, with retry guidance", async () => {
    const { store } = stubStore();
    const rule = workspaceRule(2);

    await protect({ context: "t", limits: [rule], onStoreFailure: "closed", store });
    await protect({ context: "t", limits: [rule], onStoreFailure: "closed", store });
    const third = await protect({ context: "t", limits: [rule], onStoreFailure: "closed", store });

    expect(third.allowed).toBe(false);
    if (third.allowed) throw new Error("unreachable");
    expect(third.reason).toBe("rate_limited");
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    expect(third.scope).toBe("public-api");
  });

  it("lets the caller through again in the next window", async () => {
    const { store } = stubStore();
    const rule = workspaceRule(1);
    const nowMs = 1_700_000_000_000;

    expect((await protect({ context: "t", limits: [rule], onStoreFailure: "closed", store, nowMs })).allowed).toBe(true);
    expect((await protect({ context: "t", limits: [rule], onStoreFailure: "closed", store, nowMs })).allowed).toBe(false);
    // One whole window later the bucket is a different row entirely.
    expect(
      (await protect({ context: "t", limits: [rule], onStoreFailure: "closed", store, nowMs: nowMs + 60_000 })).allowed,
    ).toBe(true);
  });

  it("stops a flood costing a round trip once the pre-filter knows the answer", async () => {
    const { store, calls } = stubStore();
    const rule = workspaceRule(2);
    const args = { context: "t", limits: [rule], onStoreFailure: "closed" as const, store };

    await protect(args);
    await protect(args);
    const consumedBeforeFlood = calls.consume;

    // Every one of these is refused locally: the local count for this window
    // already exceeds the ceiling, and the local count can never exceed the
    // global one, so the authority could only agree.
    for (let i = 0; i < 25; i++) {
      expect((await protect(args)).allowed).toBe(false);
    }
    expect(calls.consume).toBe(consumedBeforeFlood);
  });

  it("charges limits in order and stops at the first refusal", async () => {
    const consumed: string[] = [];
    const { store } = stubStore({
      async consume({ scope }) {
        consumed.push(scope);
        return { count: 99, allowed: false, remaining: 0, retryAfterSeconds: 30 };
      },
    });

    const outcome = await protect({
      context: "t",
      limits: [workspaceRule(10), workspaceRule(10, { key: { scope: "public-chat", dimension: "chatbot", id: uniqueId("bot") } })],
      onStoreFailure: "closed",
      store,
    });

    expect(outcome.allowed).toBe(false);
    // The second ceiling was never charged, because the first already refused.
    expect(consumed).toEqual(["public-api"]);
  });

  describe("stacks that bound nothing", () => {
    it("refuses a stack with no server-derived dimension", async () => {
      const { store } = stubStore();
      const ipOnly: RateLimitRule = { key: { scope: "public-chat", dimension: "ip", id: "203.0.113.9" }, limit: 30, windowMs: 60_000 };

      await expect(protect({ context: "widget", limits: [ipOnly], onStoreFailure: "closed", store })).rejects.toThrow(
        /no server-derived dimension/,
      );
    });

    it("refuses a caller-derived ceiling placed in front of a server-derived one", async () => {
      const { store } = stubStore();
      const ip: RateLimitRule = { key: { scope: "public-chat", dimension: "ip", id: "203.0.113.9" }, limit: 30, windowMs: 60_000 };

      await expect(
        protect({ context: "widget", limits: [ip, workspaceRule(600)], onStoreFailure: "closed", store }),
      ).rejects.toThrow(/Server-derived ceilings must come first/);
    });

    it("refuses a nonsensical limit or window", async () => {
      const { store } = stubStore();
      await expect(
        protect({ context: "t", limits: [workspaceRule(-1)], onStoreFailure: "closed", store }),
      ).rejects.toThrow(/non-negative integer/);
      await expect(
        protect({ context: "t", limits: [workspaceRule(10, { windowMs: 0 })], onStoreFailure: "closed", store }),
      ).rejects.toThrow(/positive integer/);
    });
  });

  describe("when the store itself is down", () => {
    const broken = () => stubStore({ async consume() { throw new Error("connection refused"); } }).store;

    it("fails closed where a gap would be a security hole", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const outcome = await protect({ context: "sign-in", limits: [workspaceRule(10)], onStoreFailure: "closed", store: broken() });

      expect(outcome.allowed).toBe(false);
      if (outcome.allowed) throw new Error("unreachable");
      // Not 429: the caller did nothing wrong, and telling them to slow down
      // would misplace the fault.
      expect(outcome.reason).toBe("unavailable");
      error.mockRestore();
    });

    it("fails open where refusing would turn a limiter outage into an outage", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const outcome = await protect({ context: "dashboard", limits: [workspaceRule(10)], onStoreFailure: "open", store: broken() });

      expect(outcome).toEqual({ allowed: true });
      error.mockRestore();
    });

    it("still applies the per-instance ceiling while failing open", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const rule = workspaceRule(2);
      const args = { context: "dashboard", limits: [rule], onStoreFailure: "open" as const, store: broken() };

      expect((await protect(args)).allowed).toBe(true);
      expect((await protect(args)).allowed).toBe(true);
      // Degraded to per-instance limiting, which is strictly better than none.
      expect((await protect(args)).allowed).toBe(false);
      error.mockRestore();
    });
  });
});

describe("withConcurrencyLease", () => {
  const key: ProtectionKey = { scope: "agent-run", dimension: "workspace", id: "ws-1" };

  it("runs the work holding a slot and releases it afterwards", async () => {
    const { store, calls } = stubStore();
    const result = await withConcurrencyLease({ key, limit: 2, ttlMs: 30_000, store }, async () => "done");

    expect(result).toBe("done");
    expect(calls.acquire).toBe(1);
    expect(calls.release).toBe(1);
  });

  it("releases the slot when the work throws", async () => {
    const { store, calls } = stubStore();

    await expect(
      withConcurrencyLease({ key, limit: 2, ttlMs: 30_000, store }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // The failure path is exactly where a slot would otherwise leak.
    expect(calls.release).toBe(1);
  });

  it("refuses when every slot is held, without running the work", async () => {
    const { store } = stubStore({ async acquireLease() { return null; } });
    const work = vi.fn();

    await expect(withConcurrencyLease({ key, limit: 2, ttlMs: 30_000, store }, work)).rejects.toMatchObject({
      code: "concurrency_limit",
      status: 429,
    });
    expect(work).not.toHaveBeenCalled();
  });

  it("does not turn a failed release into a failed request", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = stubStore({ async releaseLease() { throw new Error("connection lost"); } });

    // A lost release costs one slot until it expires; failing the caller's
    // already-completed work would be worse.
    await expect(withConcurrencyLease({ key, limit: 2, ttlMs: 30_000, store }, async () => "done")).resolves.toBe("done");
    error.mockRestore();
  });
});

describe("toProtectionError", () => {
  it("distinguishes the refusals a client must handle differently", () => {
    const limited = toProtectionError({ allowed: false, reason: "rate_limited", retryAfterSeconds: 30, scope: "public-api" });
    expect(limited.code).toBe("rate_limited");
    expect(limited.status).toBe(429);
    expect(limited.retryAfterSeconds).toBe(30);

    const concurrent = toProtectionError({ allowed: false, reason: "concurrency_limit", retryAfterSeconds: 5, scope: "agent-run" });
    expect(concurrent.code).toBe("concurrency_limit");
    expect(concurrent.status).toBe(429);

    const down = toProtectionError({ allowed: false, reason: "unavailable", retryAfterSeconds: 5, scope: "sign-in" });
    expect(down.code).toBe("unavailable");
    expect(down.status).toBe(503);
  });

  it("never names the key, the counter or the limit", () => {
    const error = toProtectionError({ allowed: false, reason: "rate_limited", retryAfterSeconds: 30, scope: "public-api" });
    expect(error).toBeInstanceOf(ApiError);
    // An attacker must not be able to read the shape of the control off the
    // refusal: no key, no bucket count, no ceiling, no scope label.
    expect(error.message).not.toMatch(/public-api|workspace|bucket|count|[0-9a-f]{16}/);
  });
});
