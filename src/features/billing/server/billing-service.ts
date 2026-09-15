import "server-only";

import {
  DEFAULT_PERIOD_DAYS,
  METERED_ENTITLEMENT_KINDS,
  isMeteredEntitlement,
} from "@/features/billing/constants";
import { noPlanCheck, resolveLimit, unknownPlanCheck } from "@/features/billing/entitlement-rules";
import type { AssignPlanValues } from "@/features/billing/schemas";
import {
  deleteSubscription,
  findSubscription,
  sumUsageByKindInPeriod,
  upsertSubscription,
} from "@/features/billing/server/billing-repository";
import { resolvePlanContext } from "@/features/billing/server/entitlements";
import type { BillingOverview, EntitlementSummary } from "@/features/billing/types";
import { ENTITLEMENT_LABELS, PLANS, findPlan, pricingIsDraft } from "@/features/pricing/plans";
import { ENTITLEMENT_KEYS } from "@/features/pricing/types";
import { hasMinimumRole, type MemberRole } from "@/features/workspaces/roles";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import type { WorkspaceContext } from "@/server/auth/dal";
import { withWorkspace } from "@/server/db/client";

/**
 * Business rules for the plan assignment.
 *
 * Reading billing is an admin-level view of the workspace; CHANGING it is an
 * owner-level act. `MEMBER_ROLE_DESCRIPTIONS` already promises exactly that
 * split - "Owner: full access, including billing" - and this is where that
 * sentence becomes true rather than aspirational.
 */

export interface BillingActor {
  workspaceId: string;
  userId: string;
  actorName: string;
  role: MemberRole;
}

export function billingActor(ctx: WorkspaceContext): BillingActor {
  return {
    workspaceId: ctx.membership.workspace.id,
    userId: ctx.user.id,
    actorName: ctx.user.name,
    role: ctx.membership.role,
  };
}

/** The route floor is `owner` too; this re-checks against the resolved membership. */
function assertCanManageBilling(actor: BillingActor): void {
  if (!hasMinimumRole(actor.role, "owner")) {
    throw ApiError.forbidden("Only an owner can change this workspace's plan");
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds every row of the entitlement table.
 *
 * Metered usage is reported for the period whether or not a limit exists, so a
 * workspace can see what it is consuming while the catalogue is still silent on
 * what it is allowed - which is the state nearly every key is in today.
 */
export async function getBillingOverview(workspaceId: string): Promise<BillingOverview> {
  const context = await resolvePlanContext(workspaceId);
  const usageByKind = await sumUsageByKindInPeriod(workspaceId, context.periodStart, context.periodEnd);

  const meteredTotal = (key: (typeof ENTITLEMENT_KEYS)[number]): number | null => {
    const kinds = METERED_ENTITLEMENT_KINDS[key];
    if (!kinds) return null;
    return kinds.reduce((sum, kind) => sum + (usageByKind.get(kind) ?? 0), 0);
  };

  const entitlements: EntitlementSummary[] = ENTITLEMENT_KEYS.map((key) => {
    const periodUsage = meteredTotal(key);
    const base = context.noPlan
      ? noPlanCheck(key)
      : context.unknownPlan || !context.plan
        ? unknownPlanCheck(key)
        : // Resource keys are not measured here: their tables belong to other
          // features, and this feature does not read them. See entitlements.ts.
          resolveLimit(key, context.plan.limits[key], isMeteredEntitlement(key) ? periodUsage : null);

    return { ...base, label: ENTITLEMENT_LABELS[key], metered: isMeteredEntitlement(key), periodUsage };
  });

  return {
    subscription: context.subscription,
    periodStart: context.periodStart.toISOString(),
    periodEnd: context.periodEnd.toISOString(),
    entitlements,
    catalogueIsDraft: pricingIsDraft(),
    assignablePlans: PLANS.map((plan) => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      isDraft: plan.status === "draft",
    })),
  };
}

/**
 * Puts the workspace on a plan.
 *
 * The plan id is validated twice on purpose: `assignPlanSchema` checks it at
 * the HTTP boundary, and this re-checks after resolving, because the catalogue
 * is a TypeScript file that can change between a form being rendered and the
 * request arriving.
 */
export async function assignPlan(actor: BillingActor, input: AssignPlanValues): Promise<BillingOverview> {
  assertCanManageBilling(actor);

  const plan = findPlan(input.planId);
  if (!plan) throw ApiError.badRequest("That plan is not in the catalogue");

  const now = new Date();
  const currentPeriodEnd = input.currentPeriodEnd
    ? new Date(input.currentPeriodEnd)
    : new Date(now.getTime() + DEFAULT_PERIOD_DAYS * DAY_MS);

  const existing = await findSubscription(actor.workspaceId);

  await withWorkspace(actor.workspaceId, async (client) => {
    await upsertSubscription(
      actor.workspaceId,
      {
        planId: plan.id,
        status: input.status,
        // Re-assigning to the SAME plan continues the period it is already in;
        // switching plans starts a new one. Restarting the period on an
        // unrelated edit - flipping `cancelAtPeriodEnd`, say - would silently
        // hand back a metered allowance that had already been consumed.
        currentPeriodStart:
          existing && existing.planId === plan.id ? new Date(existing.currentPeriodStart) : now,
        currentPeriodEnd,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        assignedBy: actor.userId,
      },
      client,
    );

    await recordActivity(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        entityType: "subscription",
        entityId: null,
        action: existing ? "subscription.changed" : "subscription.assigned",
        summary: existing
          ? `${actor.actorName} changed the plan to ${plan.name}`
          : `${actor.actorName} put this workspace on ${plan.name}`,
        metadata: {
          planId: plan.id,
          status: input.status,
          previousPlanId: existing?.planId ?? null,
          cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        },
      },
      client,
    );
  });

  return getBillingOverview(actor.workspaceId);
}

/**
 * Returns the workspace to unassigned.
 *
 * Deleting the row rather than setting `canceled` because the two mean
 * different things: `canceled` records that a plan was ended, and unassigned
 * means there was never one in force. An operator undoing a mistaken assignment
 * wants the second.
 */
export async function clearPlan(actor: BillingActor): Promise<BillingOverview> {
  assertCanManageBilling(actor);

  const existing = await findSubscription(actor.workspaceId);
  if (!existing) throw ApiError.notFound("This workspace is not on a plan");

  await withWorkspace(actor.workspaceId, async (client) => {
    await deleteSubscription(actor.workspaceId, client);
    await recordActivity(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        entityType: "subscription",
        entityId: null,
        action: "subscription.cleared",
        summary: `${actor.actorName} removed this workspace's plan`,
        metadata: { previousPlanId: existing.planId },
      },
      client,
    );
  });

  return getBillingOverview(actor.workspaceId);
}
