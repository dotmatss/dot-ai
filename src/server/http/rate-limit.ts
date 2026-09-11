import "server-only";

/**
 * In-memory fixed-window rate limiter.
 *
 * Scope and limits of this implementation, so callers do not over-trust it:
 *
 * - It is per process. Behind more than one instance the effective limit is
 *   multiplied by the instance count. Cloudflare Rate Limiting (or a shared
 *   store) is the production control; this is the last line of defence.
 * - Any limit keyed on a client IP is best-effort, because the IP itself comes
 *   from request headers that only a trusted proxy can make trustworthy (see
 *   `clientIpFrom`). Anything that must hold regardless of the caller — spend
 *   ceilings in particular — has to be keyed on something server-derived, such
 *   as a chatbot or workspace id.
 * - The bucket map is bounded, so a caller rotating keys cannot exhaust memory.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_BUCKETS = 20_000;

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep >= 60_000) {
    lastSweep = now;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  // A caller rotating a spoofed header would otherwise grow this map without
  // bound between sweeps. Map iteration is insertion-ordered, so this drops the
  // oldest entries first.
  if (buckets.size > MAX_BUCKETS) {
    const excess = buckets.size - MAX_BUCKETS;
    let dropped = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, options: { limit: number; windowMs: number }): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: Math.ceil(options.windowMs / 1000) };
  }
  bucket.count += 1;
  const allowed = bucket.count <= options.limit;
  return {
    allowed,
    remaining: Math.max(0, options.limit - bucket.count),
    retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
  };
}

/**
 * Applies several limits and returns the first one that rejects.
 *
 * Order matters: put the server-derived ceilings (workspace, chatbot) before
 * caller-derived ones so a spoofed identity cannot skip them.
 */
export function checkRateLimits(
  limits: Array<{ key: string; limit: number; windowMs: number }>,
): RateLimitResult & { key: string } {
  let worst: (RateLimitResult & { key: string }) | null = null;
  for (const limit of limits) {
    const result = { ...checkRateLimit(limit.key, limit), key: limit.key };
    if (!result.allowed) return result;
    if (!worst || result.remaining < worst.remaining) worst = result;
  }
  return worst ?? { allowed: true, remaining: 0, retryAfterSeconds: 0, key: "" };
}

/**
 * Best-effort client address.
 *
 * Every value here is a request header, so it is only as trustworthy as the
 * proxy in front of the app: Cloudflare overwrites `cf-connecting-ip`, but a
 * direct caller can set it freely. Use this to spread limits across ordinary
 * callers, never as the only thing standing between an attacker and a cost.
 */
export function clientIpFrom(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}
