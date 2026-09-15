import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Comparisons over secret material.
 *
 * Shared rather than owned by a feature: it started in the integrations secret
 * box, but its only caller is API key authentication, which now lives in
 * `src/features/developer/`. A generic security primitive that two features
 * could need belongs to neither.
 */

/** Length-safe constant-time comparison for secret material (hashes, signatures). */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch; comparing lengths first leaks
  // only the length, which is fixed for every value compared here.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
