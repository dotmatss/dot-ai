import "server-only";

import { createHash } from "node:crypto";

/**
 * Protection keys: what a limit is counted against.
 *
 * The existing call sites in `src/server/http/rate-limit.ts` already follow the
 * right discipline - server-derived ceilings first, caller-derived ones last and
 * never alone - but they follow it by hand, in template literals, one route at a
 * time. This module makes that discipline checkable instead of remembered.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * A key is (scope, dimension, id). The dimension says WHERE the id came from,
 * and that is the whole point: `TRUSTED_DIMENSIONS` are resolved by the server
 * from a session, a key hash or a stored row, and cannot be influenced by the
 * caller. `UNTRUSTED_DIMENSIONS` come from request headers or user-supplied
 * text, and a caller can rotate them at will.
 *
 * `assertBoundedByTrustedDimension` refuses a policy stack made only of
 * untrusted dimensions, so "the limit an attacker can escape by changing a
 * header" cannot be the only thing standing in front of a cost. That was
 * previously a comment; it is now a thrown error.
 */

/**
 * Identity the SERVER resolved. A caller cannot change which workspace its API
 * key belongs to, or which chatbot an embed key names.
 */
export const TRUSTED_DIMENSIONS = ["platform", "organization", "workspace", "apiKey", "user", "chatbot", "agent"] as const;

/**
 * Identity the CALLER supplied, directly or indirectly.
 *
 * `ip` is a request header and only as trustworthy as the proxy in front of the
 * app. `email` is typed into a form by whoever is at the keyboard - useful for
 * bounding credential stuffing against one account, worthless as a ceiling,
 * because an attacker targeting many accounts simply varies it. `session` is a
 * client-held identifier for an anonymous visitor, which makes it a convenience
 * for spreading a budget fairly, not a boundary.
 */
export const UNTRUSTED_DIMENSIONS = ["ip", "email", "session"] as const;

export type TrustedDimension = (typeof TRUSTED_DIMENSIONS)[number];
export type UntrustedDimension = (typeof UNTRUSTED_DIMENSIONS)[number];
export type ProtectionDimension = TrustedDimension | UntrustedDimension;

const TRUSTED = new Set<string>(TRUSTED_DIMENSIONS);

export function isTrustedDimension(dimension: ProtectionDimension): dimension is TrustedDimension {
  return TRUSTED.has(dimension);
}

export interface ProtectionKey {
  /**
   * The surface being protected: 'sign-in', 'public-api', 'public-chat'.
   *
   * Stored in clear next to the hash, so an operator can see WHICH protection
   * fired without seeing WHO it fired on. It must therefore never carry an
   * identifier - `assertSafeScope` enforces the shape.
   */
  scope: string;
  dimension: ProtectionDimension;
  /** Server-resolved id, or the caller-derived value for an untrusted dimension. */
  id: string;
}

/**
 * Scope labels are operator-facing telemetry, so they are constrained to a
 * shape that cannot smuggle a workspace id, an email or an address into a
 * column that is deliberately not private.
 */
const SAFE_SCOPE = /^[a-z][a-z0-9-]{0,39}$/;

export function assertSafeScope(scope: string): void {
  if (!SAFE_SCOPE.test(scope)) {
    throw new Error(`Invalid protection scope "${scope}": expected lowercase letters, digits and hyphens (max 40).`);
  }
}

/**
 * The canonical string form, which is hashed and then discarded.
 *
 * Separator collisions are not a concern despite `id` being unconstrained: the
 * first two segments come from closed sets, so a colon inside an id can only
 * ever extend its own segment. Two different (scope, dimension) pairs cannot be
 * made to produce one string.
 */
export function keyString(key: ProtectionKey): string {
  assertSafeScope(key.scope);
  return `${key.scope}:${key.dimension}:${key.id}`;
}

/**
 * What actually reaches the database.
 *
 * A key routinely contains an email address or a client address. The counter
 * behind it is operational telemetry that operators read and that outlives the
 * request, so the identifier is hashed before it is stored - the limiter needs
 * to know that two requests share a key, never what the key was.
 */
export function hashKey(key: ProtectionKey): string {
  return createHash("sha256").update(keyString(key)).digest("hex");
}

/**
 * Refuses a stack of limits that an attacker could escape by changing a header.
 *
 * Called by `protect()` before anything is consulted, so a surface protected
 * only by an IP limit fails loudly during development rather than quietly in
 * production. The one deliberate exception is a `platform` dimension with a
 * fixed id - a global ceiling, like the public demo's - which bounds total cost
 * regardless of who calls.
 */
export function assertBoundedByTrustedDimension(keys: readonly ProtectionKey[], context: string): void {
  if (keys.length === 0) throw new Error(`Protection stack for "${context}" is empty.`);
  if (!keys.some((key) => isTrustedDimension(key.dimension))) {
    const dimensions = keys.map((key) => key.dimension).join(", ");
    throw new Error(
      `Protection stack for "${context}" has no server-derived dimension (only: ${dimensions}). ` +
        `A caller can rotate every one of those, so this stack bounds nothing. ` +
        `Add a workspace, apiKey, chatbot, agent, user or platform ceiling.`,
    );
  }
}

/** Aligns a timestamp to the fixed window that contains it. */
export function windowStartMs(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}
