// @vitest-environment node
/**
 * What a protection key may be built from, and what it may never leak.
 *
 * Two properties are load-bearing here and neither is obvious from reading the
 * call sites:
 *
 *   1. A key's identifier never reaches storage in clear. Keys routinely
 *      contain an email address or a client address, and the counter behind
 *      them is operational telemetry an operator reads.
 *   2. The trusted/untrusted split is a real classification, not a label.
 *      Everything in `UNTRUSTED_DIMENSIONS` is something a caller can rotate,
 *      so a stack made only of those bounds nothing at all.
 */
import { describe, expect, it } from "vitest";

import {
  TRUSTED_DIMENSIONS,
  UNTRUSTED_DIMENSIONS,
  assertBoundedByTrustedDimension,
  assertSafeScope,
  hashKey,
  isTrustedDimension,
  keyString,
  windowStartMs,
  type ProtectionKey,
} from "@/server/protection/keys";

const workspaceKey: ProtectionKey = { scope: "public-api", dimension: "workspace", id: "ws-1" };
const ipKey: ProtectionKey = { scope: "public-api", dimension: "ip", id: "203.0.113.9" };

describe("protection keys", () => {
  it("classifies every dimension exactly once", () => {
    const overlap = TRUSTED_DIMENSIONS.filter((d) => (UNTRUSTED_DIMENSIONS as readonly string[]).includes(d));
    expect(overlap).toEqual([]);
    expect(TRUSTED_DIMENSIONS.every(isTrustedDimension)).toBe(true);
    expect(UNTRUSTED_DIMENSIONS.some(isTrustedDimension)).toBe(false);
  });

  it("never exposes the identifier in the hash", () => {
    const email: ProtectionKey = { scope: "sign-in", dimension: "email", id: "victim@example.com" };
    const hash = hashKey(email);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("victim");
    expect(hash).not.toContain("example.com");
  });

  it("is stable for the same key and distinct across dimensions", () => {
    expect(hashKey(workspaceKey)).toBe(hashKey({ ...workspaceKey }));
    // The same id under a different dimension is a different counter: a user id
    // that happened to equal a workspace id must not share a bucket.
    expect(hashKey({ scope: "public-api", dimension: "user", id: "ws-1" })).not.toBe(hashKey(workspaceKey));
    expect(hashKey({ scope: "public-chat", dimension: "workspace", id: "ws-1" })).not.toBe(hashKey(workspaceKey));
  });

  it("keeps one tenant out of another's counter", () => {
    expect(hashKey({ ...workspaceKey, id: "ws-2" })).not.toBe(hashKey(workspaceKey));
  });

  it("cannot be made to collide by putting a separator in the id", () => {
    // `scope` and `dimension` come from closed sets, so a colon inside an id can
    // only ever extend its own trailing segment.
    const a = keyString({ scope: "public-api", dimension: "workspace", id: "a:b" });
    const b = keyString({ scope: "public-api", dimension: "workspace", id: "a" });
    expect(a).not.toBe(b);
    expect(hashKey({ scope: "public-api", dimension: "workspace", id: "a:b" })).not.toBe(
      hashKey({ scope: "public-api", dimension: "workspace", id: "a" }),
    );
  });

  it("refuses a scope that could carry an identifier", () => {
    expect(() => assertSafeScope("public-api")).not.toThrow();
    expect(() => assertSafeScope("sign-in")).not.toThrow();
    // The scope column is deliberately readable by operators, so anything that
    // could smuggle a tenant id or an address into it is refused.
    expect(() => assertSafeScope("workspace:8f14e45f")).toThrow(/Invalid protection scope/);
    expect(() => assertSafeScope("user@example.com")).toThrow(/Invalid protection scope/);
    expect(() => assertSafeScope("Public-API")).toThrow(/Invalid protection scope/);
    expect(() => assertSafeScope("")).toThrow(/Invalid protection scope/);
    expect(() => assertSafeScope("a".repeat(41))).toThrow(/Invalid protection scope/);
  });

  it("refuses a stack that only a caller-derived key bounds", () => {
    expect(() => assertBoundedByTrustedDimension([ipKey], "widget")).toThrow(/no server-derived dimension/);
    expect(() => assertBoundedByTrustedDimension([], "widget")).toThrow(/empty/);
    expect(() => assertBoundedByTrustedDimension([workspaceKey, ipKey], "widget")).not.toThrow();
  });

  it("accepts a global platform ceiling as sufficient on its own", () => {
    // The public demo is anonymous and tenant-less: its global ceiling is what
    // bounds total cost, however many visitors arrive.
    expect(() =>
      assertBoundedByTrustedDimension([{ scope: "public-demo", dimension: "platform", id: "global" }, ipKey], "demo"),
    ).not.toThrow();
  });
});

describe("window alignment", () => {
  it("puts two instances in the same window without coordinating", () => {
    const windowMs = 60_000;
    // Derived from an aligned base rather than two hand-picked instants: the
    // obvious-looking pair 1_700_000_017_123 / 1_700_000_059_999 is only ~43
    // seconds apart but straddles a boundary, so hardcoding "two instants in
    // the same minute" is easy to get wrong and reads as an implementation bug.
    const start = 1_700_000_040_000;
    expect(start % windowMs).toBe(0);

    expect(windowStartMs(start, windowMs)).toBe(start);
    expect(windowStartMs(start + 17_123, windowMs)).toBe(start);
    expect(windowStartMs(start + windowMs - 1, windowMs)).toBe(start);
  });

  it("moves to a new window at the boundary", () => {
    const windowMs = 60_000;
    const start = windowStartMs(1_700_000_017_123, windowMs);
    expect(windowStartMs(start + windowMs, windowMs)).toBe(start + windowMs);
    expect(windowStartMs(start + windowMs - 1, windowMs)).toBe(start);
  });

  it("is a multiple of the window, so the value is derivable rather than negotiated", () => {
    for (const windowMs of [1_000, 60_000, 900_000]) {
      expect(windowStartMs(Date.now(), windowMs) % windowMs).toBe(0);
    }
  });
});
