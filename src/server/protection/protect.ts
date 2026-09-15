import "server-only";

import { after } from "next/server";

import { ApiError } from "@/lib/api/api-error";
import { checkRateLimit } from "@/server/http/rate-limit";
import {
  assertBoundedByTrustedDimension,
  assertSafeScope,
  hashKey,
  isTrustedDimension,
  windowStartMs,
  type ProtectionKey,
} from "@/server/protection/keys";
import { postgresProtectionStore, type ProtectionStore } from "@/server/protection/store";

/**
 * The single entry point for "may this request proceed".
 *
 * ── Two layers, and why one of them may only say no ─────────────────────────
 *
 * Every check consults the in-process limiter first and the shared store
 * second. The pre-filter is allowed to REJECT on its own and is never allowed
 * to ALLOW on its own, and that asymmetry is what makes it safe rather than a
 * second source of truth.
 *
 * It holds because both layers key on the same absolute-aligned window: the
 * local count for a window can never exceed the global count for that window,
 * because the local process's requests are a subset of everyone's. So a local
 * count over the ceiling proves the global count is over it too, and the
 * database round trip would only confirm what is already known. The converse is
 * false - which is exactly why an allow must still be asked for.
 *
 * The practical value is that a flood costs one `Map` lookup per request after
 * the first rejection, instead of a database write per request. An abuse
 * control that becomes expensive under abuse is not much of a control.
 */

export interface RateLimitRule {
  key: ProtectionKey;
  /** Requests permitted per window. */
  limit: number;
  windowMs: number;
}

export type ProtectionOutcome =
  | { allowed: true }
  | { allowed: false; reason: "rate_limited" | "concurrency_limit" | "unavailable"; retryAfterSeconds: number; scope: string };

export interface ProtectOptions {
  /** Names the surface in errors and diagnostics. Not stored. */
  context: string;
  /**
   * Evaluated in order, so put the ceilings that must hold first. The order is
   * also checked: see `assertOrdering`.
   */
  limits: readonly RateLimitRule[];
  /**
   * What to do when the STORE ITSELF fails.
   *
   * Required, never defaulted. `docs/abuse-prevention-gate.md` §4.10 sets this
   * per category rather than globally, and the whole point of that decision is
   * lost if a call site can omit it and inherit someone else's judgement.
   */
  onStoreFailure: "closed" | "open";
  store?: ProtectionStore;
  nowMs?: number;
}

/**
 * Refuses a stack whose untrusted limits are not all behind its trusted ones.
 *
 * `checkRateLimits` already documents this ordering ("put the server-derived
 * ceilings before caller-derived ones so a spoofed identity cannot skip them")
 * and every existing call site obeys it. The reason it has to be enforced and
 * not merely documented: limits are consumed in order and evaluation stops at
 * the first rejection, so an IP limit placed first lets a caller rotating a
 * header exhaust nothing but its own bucket, while the workspace ceiling behind
 * it is never even charged.
 */
function assertOrdering(limits: readonly RateLimitRule[], context: string): void {
  let seenUntrusted = false;
  for (const rule of limits) {
    const trusted = isTrustedDimension(rule.key.dimension);
    if (trusted && seenUntrusted) {
      throw new Error(
        `Protection stack for "${context}" puts a caller-derived limit (${rule.key.dimension}) ` +
          `before a server-derived one (${rule.key.dimension}). Server-derived ceilings must come first: ` +
          `evaluation stops at the first rejection, so anything behind a rotatable key is never charged.`,
      );
    }
    if (!trusted) seenUntrusted = true;
    assertSafeScope(rule.key.scope);
    if (!Number.isInteger(rule.limit) || rule.limit < 0) {
      throw new Error(`Protection limit for "${context}" must be a non-negative integer, got ${rule.limit}.`);
    }
    if (!Number.isInteger(rule.windowMs) || rule.windowMs <= 0) {
      throw new Error(`Protection window for "${context}" must be a positive integer, got ${rule.windowMs}.`);
    }
  }
}

/** ~1 request in 200 pays for cleanup, off the critical path. */
const SWEEP_PROBABILITY = 0.005;

function scheduleSweep(store: ProtectionStore): void {
  if (Math.random() >= SWEEP_PROBABILITY) return;
  const task = async () => {
    try {
      await store.sweep();
    } catch (error) {
      // Expired rows are harmless: `consume` keys on the window and
      // `acquireLease` re-checks `expires_at`, so a failed sweep costs disk,
      // never correctness.
      console.error("[protection] sweep failed", error);
    }
  };
  try {
    after(task);
  } catch {
    // Outside a request scope (a script, a test).
    void task();
  }
}

export async function protect(options: ProtectOptions): Promise<ProtectionOutcome> {
  const { context, limits, onStoreFailure } = options;
  const store = options.store ?? postgresProtectionStore;
  const nowMs = options.nowMs ?? Date.now();

  assertBoundedByTrustedDimension(
    limits.map((rule) => rule.key),
    context,
  );
  assertOrdering(limits, context);

  for (const rule of limits) {
    const windowStart = windowStartMs(nowMs, rule.windowMs);
    const keyHash = hashKey(rule.key);

    // Local pre-filter. Keyed on the aligned window so the subset argument
    // above holds exactly; a fresh key each window means the existing bounded
    // map expires these on its own.
    const local = checkRateLimit(`protect:${keyHash}:${windowStart}`, { limit: rule.limit, windowMs: rule.windowMs });
    if (!local.allowed) {
      return {
        allowed: false,
        reason: "rate_limited",
        retryAfterSeconds: Math.max(1, Math.ceil((windowStart + rule.windowMs - nowMs) / 1000)),
        scope: rule.key.scope,
      };
    }

    try {
      const decision = await store.consume({
        keyHash,
        scope: rule.key.scope,
        limit: rule.limit,
        windowMs: rule.windowMs,
        windowStartMs: windowStart,
      });
      if (!decision.allowed) {
        return { allowed: false, reason: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds, scope: rule.key.scope };
      }
    } catch (error) {
      console.error("[protection] store unavailable", { context, scope: rule.key.scope, error });
      if (onStoreFailure === "closed") {
        return { allowed: false, reason: "unavailable", retryAfterSeconds: 5, scope: rule.key.scope };
      }
      // Fail open: the local pre-filter above already ran and allowed this
      // request, so an outage degrades to per-instance limiting rather than to
      // no limiting at all.
    }
  }

  scheduleSweep(store);
  return { allowed: true };
}

/**
 * Runs `fn` holding a concurrency slot, or refuses.
 *
 * The lease is released in a `finally`, matching how `deadlineSignal` in
 * `agent-execution.ts` already cleans up: the release must happen on the throw
 * path too, because the failure case is exactly when slots would otherwise leak.
 * Release is best effort - a lost release costs one slot until `expires_at`,
 * which is the crash-safety behaviour the lease is designed around anyway.
 */
export async function withConcurrencyLease<T>(
  options: { key: ProtectionKey; limit: number; ttlMs: number; store?: ProtectionStore },
  fn: () => Promise<T>,
): Promise<T> {
  const store = options.store ?? postgresProtectionStore;
  const keyHash = hashKey(options.key);

  const lease = await store.acquireLease({
    keyHash,
    scope: options.key.scope,
    limit: options.limit,
    ttlMs: options.ttlMs,
  });

  if (!lease) {
    throw ApiError.concurrencyLimit();
  }

  try {
    return await fn();
  } finally {
    await store.releaseLease(lease.leaseId).catch((error) => {
      console.error("[protection] lease release failed", { scope: options.key.scope, error });
    });
  }
}

/** Maps a refusal to the error the HTTP boundary should return. */
export function toProtectionError(outcome: Extract<ProtectionOutcome, { allowed: false }>): ApiError {
  switch (outcome.reason) {
    case "concurrency_limit":
      return ApiError.concurrencyLimit(undefined, outcome.retryAfterSeconds);
    case "unavailable":
      // Deliberately not 429: nothing the caller did caused this, and telling
      // them to slow down would be a lie about where the fault is.
      return ApiError.unavailable("Service temporarily unavailable. Retry shortly.", outcome.retryAfterSeconds);
    case "rate_limited":
      return ApiError.rateLimited(`Rate limit exceeded. Retry in ${outcome.retryAfterSeconds}s.`, outcome.retryAfterSeconds);
  }
}
