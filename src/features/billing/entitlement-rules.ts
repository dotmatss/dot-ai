/**
 * How a plan limit becomes an answer. Pure, synchronous, and deliberately free
 * of `server-only` so the rules can be tested directly and reused on the client
 * to predict what the server will say.
 *
 * THE RULE THAT MATTERS
 * --------------------
 * Only a DECIDED limit is enforceable. Most of the catalogue is still
 * `{ kind: "undecided" }`, and an undecided limit must allow the action while
 * reporting that nothing was enforced. Turning "nobody has decided yet" into a
 * denial would invent a business model; turning it into a plain "allowed" would
 * let a caller believe the plan grants something it has not been asked about.
 * That is what `enforced` separates, and every caller should branch on it
 * rather than on `allowed` alone when it wants to know whether a rule exists.
 */

import type { EntitlementCheck, EntitlementReason, EntitlementUsage } from "@/features/billing/types";
import type { EntitlementKey, PlanLimit } from "@/features/pricing/types";

/** The reasons that mean "no rule was applied", whatever `allowed` says. */
const UNENFORCED_REASONS: ReadonlySet<EntitlementReason> = new Set<EntitlementReason>([
  "no_plan",
  "unknown_plan",
  "undecided",
  "agreed",
  "not_measured",
]);

export function isEnforced(reason: EntitlementReason): boolean {
  return !UNENFORCED_REASONS.has(reason);
}

/**
 * Resolves one limit against the current value, when that value is known.
 *
 * `current` is null whenever the caller could not measure the thing - either
 * because it is a resource this feature does not own (see
 * `METERED_ENTITLEMENT_KINDS`) or because the caller simply did not ask for a
 * measured check. A decided numeric limit with an unknown current value is
 * `not_measured`: permitted, but explicitly unverified.
 */
export function resolveLimit(key: EntitlementKey, limit: PlanLimit, current: number | null): EntitlementCheck {
  const check = (reason: EntitlementReason, allowed: boolean, usage: EntitlementUsage | null = null): EntitlementCheck => ({
    key,
    allowed,
    reason,
    enforced: isEnforced(reason),
    limit,
    usage,
  });

  switch (limit.kind) {
    case "unavailable":
      return check("unavailable", false);
    case "included":
      return check("included", true);
    case "unlimited":
      return check("unlimited", true);
    // Agreed in a contract, not in this system. Nothing here can check it, and
    // guessing a number for it would be worse than admitting that.
    case "custom":
      return check("agreed", true);
    case "undecided":
      return check("undecided", true);
    case "count": {
      if (current === null) return check("not_measured", true);
      const usage: EntitlementUsage = {
        current,
        limit: limit.value,
        // Clamped: a workspace 3 over its limit has 0 remaining, not -3. The
        // page renders this straight into a progress bar.
        remaining: Math.max(0, limit.value - current),
      };
      return current >= limit.value ? check("limit_reached", false, usage) : check("within_limit", true, usage);
    }
  }
}

/**
 * The answer when no plan is in force - unassigned, or an assignment that was
 * canceled. Nothing is enforced, so nothing is denied.
 */
export function noPlanCheck(key: EntitlementKey): EntitlementCheck {
  return { key, allowed: true, reason: "no_plan", enforced: false, limit: { kind: "undecided" }, usage: null };
}

/** The answer when the stored plan id is not in the catalogue any more. */
export function unknownPlanCheck(key: EntitlementKey): EntitlementCheck {
  return { key, allowed: true, reason: "unknown_plan", enforced: false, limit: { kind: "undecided" }, usage: null };
}
