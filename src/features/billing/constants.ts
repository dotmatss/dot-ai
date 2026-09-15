import type { BadgeTone } from "@/components/ui/app-badge";
import type { EntitlementReason, SubscriptionStatus } from "@/features/billing/types";
import type { EntitlementKey } from "@/features/pricing/types";
import type { UsageKind } from "@/features/analytics/types";

export const SUBSCRIPTION_STATUS_META: Record<SubscriptionStatus, { label: string; tone: BadgeTone; description: string }> = {
  active: { label: "Active", tone: "success", description: "This workspace is on this plan and its limits apply." },
  trialing: { label: "Trialing", tone: "info", description: "On this plan for an evaluation period; limits apply as normal." },
  past_due: {
    label: "Past due",
    tone: "warning",
    description: "Flagged as past due. Nothing is restricted by this status on its own.",
  },
  canceled: {
    label: "Canceled",
    tone: "neutral",
    description: "The assignment has been ended. Limits are no longer enforced.",
  },
};

/**
 * How each outcome is worded on the page.
 *
 * The three "nothing to enforce" reasons deliberately do NOT read as approval.
 * "Allowed" would be a lie by omission where no limit has been decided, and
 * that distinction is the whole reason `EntitlementCheck.enforced` exists.
 */
export const ENTITLEMENT_REASON_META: Record<EntitlementReason, { label: string; tone: BadgeTone }> = {
  no_plan: { label: "No plan", tone: "neutral" },
  unknown_plan: { label: "Unknown plan", tone: "warning" },
  undecided: { label: "Not decided", tone: "neutral" },
  not_measured: { label: "Not measured", tone: "neutral" },
  unlimited: { label: "Unlimited", tone: "success" },
  included: { label: "Included", tone: "success" },
  agreed: { label: "Agreed", tone: "info" },
  within_limit: { label: "Within limit", tone: "success" },
  limit_reached: { label: "Limit reached", tone: "danger" },
  unavailable: { label: "Not in plan", tone: "danger" },
};

/**
 * The entitlement keys counted over the billing period, and the `usage_events`
 * kinds each one sums.
 *
 * These are the only keys this feature can measure by itself. `usage_events` is
 * platform-owned, so reading it crosses no feature boundary. Every other key
 * counts rows in a table another feature owns - chatbots, agents, CRM contacts -
 * and per `docs/feature-conventions.md` this feature does not write SQL over
 * those. Their current values are supplied BY the owning feature when it asks
 * for a check; see `checkEntitlement` in server/entitlements.ts.
 */
export const METERED_ENTITLEMENT_KINDS: Partial<Record<EntitlementKey, ReadonlyArray<UsageKind>>> = {
  messagesPerMonth: ["message"],
  tokensPerMonth: ["tokens_in", "tokens_out"],
  workflowRunsPerMonth: ["workflow_run"],
};

export function isMeteredEntitlement(key: EntitlementKey): boolean {
  return key in METERED_ENTITLEMENT_KINDS;
}

/**
 * Fallback billing period for a workspace with no subscription row: the current
 * calendar month, UTC. Only used for reporting - an unassigned workspace has no
 * limits to count against - but the page still shows metered totals, and a
 * window it can name beats an arbitrary rolling one.
 */
export function calendarMonthPeriod(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/** Default length of an assigned period, in days, when a caller does not supply one. */
export const DEFAULT_PERIOD_DAYS = 30;
