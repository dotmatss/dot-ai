/**
 * Client-safe billing contracts. Timestamps are ISO strings; every value here
 * crosses the server/client boundary unchanged.
 *
 * WHAT THIS FEATURE IS
 * --------------------
 * The layer `src/features/pricing/types.ts` described as future work: "a plan
 * states a limit per key, and a future billing layer answers 'may this
 * workspace do X' against the same keys". `EntitlementKey` is that join, and
 * this feature owns the answering.
 *
 * WHAT IT IS NOT
 * --------------
 * A payment system. No processor, no card, no invoice, no amount. The pricing
 * catalogue still carries no price, and this feature does not add one.
 */

import type { EntitlementKey, PlanLimit } from "@/features/pricing/types";

export const SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "canceled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * The plan assignment for one workspace.
 *
 * `planName` is resolved from the catalogue at read time rather than stored, so
 * renaming a plan does not require touching rows. When the stored `planId` is
 * no longer in the catalogue, `planName` is null and `planKnown` is false - the
 * page then says the plan is unrecognised instead of rendering a blank name.
 */
export interface WorkspaceSubscription {
  id: string;
  planId: string;
  planName: string | null;
  planKnown: boolean;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  assignedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Why an entitlement answered the way it did.
 *
 * Separate values rather than a boolean plus a message, because the caller and
 * the UI need to tell three very different situations apart:
 *
 *   - `no_plan` / `undecided`: allowed because there is NOTHING TO ENFORCE. The
 *     workspace is unassigned, or the catalogue has not decided this limit.
 *     Reporting these as a plain "allowed" would let a page claim the plan
 *     permits something when in fact nobody has decided yet.
 *   - `unlimited` / `included` / `agreed` / `within_limit`: allowed because the
 *     plan actually permits it.
 *   - `unavailable` / `limit_reached`: denied.
 *
 * `unknown_plan` is its own case: the row points at a plan the catalogue no
 * longer has, so nothing can be enforced and an operator needs to know.
 *
 * `not_measured` is the fourth "nothing to enforce" reason and the easiest to
 * get wrong: the plan DID decide a number, but the caller did not supply the
 * current value, so the check could not be made. Reporting it as
 * `within_limit` would assert something nobody measured.
 */
export const ENTITLEMENT_REASONS = [
  "no_plan",
  "unknown_plan",
  "undecided",
  "unlimited",
  "included",
  "agreed",
  "not_measured",
  "within_limit",
  "limit_reached",
  "unavailable",
] as const;
export type EntitlementReason = (typeof ENTITLEMENT_REASONS)[number];

/** Current consumption against a numeric limit. Only ever set when both are known. */
export interface EntitlementUsage {
  current: number;
  limit: number;
  /** Never negative: a limit that has been exceeded reports 0 remaining, not -3. */
  remaining: number;
}

/**
 * The answer to "may this workspace do X", and everything needed to explain it.
 *
 * `enforced` is the field that keeps this honest. It is false whenever the
 * outcome was decided by an absence - no plan, an undecided limit, an
 * unrecognised plan - so a caller can never mistake "we did not check" for "the
 * plan allows it".
 */
export interface EntitlementCheck {
  key: EntitlementKey;
  allowed: boolean;
  reason: EntitlementReason;
  /** False when the outcome came from an absence rather than from a decision. */
  enforced: boolean;
  limit: PlanLimit;
  usage: EntitlementUsage | null;
}

/** One row of the billing page's entitlement table. */
export interface EntitlementSummary extends EntitlementCheck {
  label: string;
  /** True for the keys counted over the billing period rather than held as a total. */
  metered: boolean;
  /**
   * What the workspace actually consumed this period, for metered keys, whether
   * or not a limit has been decided. Distinct from `usage`, which exists only
   * when there is a number to compare against: this one answers "how much have
   * we used" even while the plan is silent on how much is allowed - which is
   * the state most of the catalogue is in.
   */
  periodUsage: number | null;
}

/**
 * Everything the billing page renders.
 *
 * `subscription` is null for an unassigned workspace, which is a real state and
 * not an error: nothing is enforced, and the page says so.
 */
export interface BillingOverview {
  subscription: WorkspaceSubscription | null;
  /** The window metered entitlements were counted over. */
  periodStart: string;
  periodEnd: string;
  entitlements: EntitlementSummary[];
  /** True when any plan in the catalogue is still a draft. */
  catalogueIsDraft: boolean;
  /** Plans an owner may assign, for the picker. */
  assignablePlans: Array<{ id: string; name: string; description: string; isDraft: boolean }>;
}
