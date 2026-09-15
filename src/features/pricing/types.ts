import type { Route } from "next";

/**
 * The pricing domain model.
 *
 * Two things this exists to prevent. First, pricing scattered through JSX, so
 * that changing a limit means hunting through components. Second, and more
 * important here: a page that *looks* finished while the business model is
 * not. Every number below is explicitly a placeholder until someone decides
 * it, and the type system will not let a plan quietly ship with an invented
 * price.
 *
 * The model is also shaped so that entitlements can attach to it later without
 * a rewrite. `EntitlementKey` is the join: a plan states a limit per key, and a
 * future billing layer answers "may this workspace do X" against the same keys.
 */

export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/**
 * Capabilities a plan can grant or limit.
 *
 * Every key names something the product ACTUALLY HAS today. Which tier gets how
 * much of it is undecided; that a chatbot, a workflow, a knowledge collection, an API
 * key and a CRM contact exist is not.
 *
 * The four metered keys line up with the `kind` values already written to
 * `usage_events`, so usage-based limits can be enforced later without a new
 * metering mechanism.
 *
 * `storageBytes` is the odd one: it is a standing total rather than something
 * consumed over a period, and it is measured by counting bytes in tables the
 * billing feature must not read. It therefore arrives as a caller-supplied
 * `current`, exactly like `chatbots` and `crmContacts`.
 */
export const ENTITLEMENT_KEYS = [
  "chatbots",
  "agents",
  "workflows",
  "collections",
  "knowledgeSources",
  "members",
  "apiAccess",
  "crmContacts",
  "integrations",
  "messagesPerMonth",
  "tokensPerMonth",
  "workflowRunsPerMonth",
  "storageBytes",
] as const;
export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

/**
 * What a plan allows for one capability.
 *
 * `undecided` is the default and is rendered as a visible gap, the same way the
 * legal pages render an unresolved value. It is not "0" and it is not a guess.
 */
export type PlanLimit =
  | { kind: "undecided" }
  | { kind: "included" }
  | { kind: "unavailable" }
  | { kind: "unlimited" }
  | { kind: "count"; value: number }
  | { kind: "custom"; label: string };

/**
 * What a plan costs.
 *
 * There is no `amount` field, deliberately. A number cannot be added here by
 * accident before the business model exists; introducing one is a visible
 * change to this type, which is the point.
 */
export type PlanPrice =
  | { kind: "free" }
  | { kind: "undecided" }
  | { kind: "contact"; label: string };

export interface PlanFeature {
  /** Short, concrete, and true of a capability the product already has. */
  label: string;
  /** Optional link to the documentation for that capability. */
  docsHref?: Route;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  /**
   * Every plan is a draft until pricing is approved. The page refuses to
   * present a draft as final, and a test asserts none has been flipped
   * without the rest of the model being filled in.
   */
  status: "draft" | "published";
  price: Record<BillingInterval, PlanPrice>;
  /** Drawn slightly forward in the grid. At most one plan may set it. */
  highlighted?: boolean;
  cta: { label: string; href: Route };
  /** Short prose, for the card. */
  features: PlanFeature[];
  /** The full matrix, for the comparison table and for future entitlements. */
  limits: Record<EntitlementKey, PlanLimit>;
}

export function isDraft(plan: Plan): boolean {
  return plan.status === "draft";
}

/** True when anything about the plan still has to be decided. */
export function hasUndecidedValues(plan: Plan): boolean {
  const priceUndecided = BILLING_INTERVALS.some((interval) => plan.price[interval].kind === "undecided");
  const limitUndecided = Object.values(plan.limits).some((limit) => limit.kind === "undecided");
  return priceUndecided || limitUndecided;
}
