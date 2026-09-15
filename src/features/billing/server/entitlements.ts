import "server-only";

import type { PoolClient } from "pg";

import { METERED_ENTITLEMENT_KINDS, calendarMonthPeriod, isMeteredEntitlement } from "@/features/billing/constants";
import { noPlanCheck, resolveLimit, unknownPlanCheck } from "@/features/billing/entitlement-rules";
import { findSubscription, sumUsageForKinds } from "@/features/billing/server/billing-repository";
import type { EntitlementCheck, WorkspaceSubscription } from "@/features/billing/types";
import { ENTITLEMENT_LABELS, findPlan } from "@/features/pricing/plans";
import type { EntitlementKey, Plan } from "@/features/pricing/types";
import { ApiError } from "@/lib/api/api-error";

/**
 * The read model other features import.
 *
 * This is the boundary `docs/feature-conventions.md` describes: a feature that
 * needs to know whether it may create another chatbot imports from here rather
 * than reading `workspace_subscriptions` itself.
 *
 * MEASURING IS THE CALLER'S JOB, AND THAT IS DELIBERATE
 * ----------------------------------------------------
 * Only the three metered keys can be counted here, because they come from
 * `usage_events`, which the platform owns. Every other key counts rows in a
 * table this feature must not touch - `chatbots`, `agents`, `crm_contacts`.
 * So the owning feature passes its own count in `current`, and a decided limit
 * with no `current` reports `not_measured` rather than silently passing.
 */

/** Resolved plan context for a workspace: what is in force, and over what window. */
interface PlanContext {
  subscription: WorkspaceSubscription | null;
  /** Undefined when no plan is in force, or when the stored plan id is unknown. */
  plan: Plan | undefined;
  periodStart: Date;
  periodEnd: Date;
  /** True when a row exists but names a plan the catalogue no longer has. */
  unknownPlan: boolean;
  /** True when no plan is in force: unassigned, or an assignment that was canceled. */
  noPlan: boolean;
}

/**
 * A canceled assignment stops enforcing. The row is kept so the page can say
 * which plan was ended and when, but its limits no longer bind - charging
 * someone against a plan they cancelled would be the wrong way round.
 */
function planIsInForce(subscription: WorkspaceSubscription | null): boolean {
  return subscription !== null && subscription.status !== "canceled";
}

export async function resolvePlanContext(workspaceId: string, client?: PoolClient): Promise<PlanContext> {
  const subscription = await findSubscription(workspaceId, client);
  const inForce = planIsInForce(subscription);
  const plan = inForce && subscription ? findPlan(subscription.planId) : undefined;
  const fallback = calendarMonthPeriod();

  return {
    subscription,
    plan,
    // An assigned plan brings its own period; everything else is reported over
    // the current calendar month so the page can still name its window.
    periodStart: inForce && subscription ? new Date(subscription.currentPeriodStart) : fallback.start,
    periodEnd: inForce && subscription ? new Date(subscription.currentPeriodEnd) : fallback.end,
    unknownPlan: inForce && subscription !== null && plan === undefined,
    noPlan: !inForce,
  };
}

/**
 * Counts a metered key over the billing period. Returns null for keys this
 * feature cannot measure, which is what turns a decided limit into
 * `not_measured` instead of a false pass.
 */
export async function measureEntitlement(
  workspaceId: string,
  key: EntitlementKey,
  periodStart: Date,
  periodEnd: Date,
  client?: PoolClient,
): Promise<number | null> {
  const kinds = METERED_ENTITLEMENT_KINDS[key];
  if (!kinds) return null;
  return sumUsageForKinds(workspaceId, kinds, periodStart, periodEnd, client);
}

export interface EntitlementCheckOptions {
  /**
   * The current value to test a numeric limit against, supplied by the feature
   * that owns the underlying table. Ignored for metered keys, which are counted
   * from `usage_events` here.
   */
  current?: number;
  client?: PoolClient;
}

/**
 * Answers "may this workspace do X".
 *
 * Never throws for a policy outcome - inspect `allowed`, and `enforced` when
 * you need to know whether any rule actually applied. Use `requireEntitlement`
 * when the answer should become an HTTP error.
 */
export async function checkEntitlement(
  workspaceId: string,
  key: EntitlementKey,
  options: EntitlementCheckOptions = {},
): Promise<EntitlementCheck> {
  const context = await resolvePlanContext(workspaceId, options.client);
  if (context.noPlan) return noPlanCheck(key);
  if (context.unknownPlan || !context.plan) return unknownPlanCheck(key);

  const limit = context.plan.limits[key];
  // A metered key is counted here; anything else uses what the caller measured.
  // The count is skipped entirely unless the limit is a number, so an undecided
  // limit costs no query.
  const current =
    limit.kind !== "count"
      ? null
      : isMeteredEntitlement(key)
        ? await measureEntitlement(workspaceId, key, context.periodStart, context.periodEnd, options.client)
        : (options.current ?? null);

  return resolveLimit(key, limit, current);
}

/**
 * Enforces an entitlement, throwing the error the API contract already defines
 * for it. A no-op whenever nothing is enforced, which is most of the catalogue
 * today.
 *
 * The two codes are not interchangeable:
 *   - `not_entitled` (403) for a capability the plan excludes, and for a
 *     resource ceiling. Retrying will never help; the plan has to change.
 *   - `quota_exceeded` (429) for a metered allowance spent within the period,
 *     which is what that code was written for. It carries no `Retry-After`,
 *     because the honest answer is "when your period rolls".
 */
export async function requireEntitlement(
  workspaceId: string,
  key: EntitlementKey,
  options: EntitlementCheckOptions = {},
): Promise<EntitlementCheck> {
  const check = await checkEntitlement(workspaceId, key, options);
  if (check.allowed) return check;

  const label = ENTITLEMENT_LABELS[key];
  if (check.reason === "unavailable") {
    throw ApiError.notEntitled(`${label} is not included in this workspace's plan`);
  }
  if (isMeteredEntitlement(key)) {
    throw ApiError.quotaExceeded(
      `This workspace has used its ${label.toLowerCase()} allowance for the current period`,
    );
  }
  throw ApiError.notEntitled(
    `This workspace has reached its plan limit for ${label.toLowerCase()} (${check.usage?.limit ?? "limit"})`,
  );
}

/**
 * The plan as a short badge plus one line, for surfaces that report usage and
 * want to name the plan beside it.
 *
 * Exported here because this is the read model other features import - see
 * "Crossing feature boundaries" in `docs/feature-conventions.md`. It replaced a
 * `CURRENT_PLAN` constant in the analytics feature that hard-coded "Free" and
 * "Credits and subscriptions are coming soon"; both had become untrue, and a
 * constant cannot tell one workspace from another.
 */
export async function getPlanLabel(workspaceId: string): Promise<{ name: string; description: string }> {
  const context = await resolvePlanContext(workspaceId);

  if (context.noPlan) {
    return {
      name: "No plan",
      description: "This workspace is not on a plan. Usage is metered, and nothing is limited or charged.",
    };
  }
  if (context.unknownPlan || !context.plan) {
    return {
      name: context.subscription?.planId ?? "Unknown",
      description: "This plan is not in the pricing catalogue, so no limits are applied.",
    };
  }
  return {
    name: context.plan.name,
    description:
      context.plan.status === "draft"
        ? `On the ${context.plan.name} plan. Its price and most of its limits are still drafts, so only the decided limits are enforced and nothing is charged.`
        : `On the ${context.plan.name} plan.`,
  };
}
