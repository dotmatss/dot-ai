import type { Route } from "next";

import { ENTITLEMENT_KEYS, type EntitlementKey, type Plan, type PlanLimit } from "@/features/pricing/types";

/**
 * The plan catalogue.
 *
 * EVERY PLAN HERE IS A DRAFT. The tiers are a plausible shape for a product
 * like this one; the prices and the limits are not decided, and nothing on
 * this page is charged today. When pricing is settled, the edits happen in
 * this file and nowhere else.
 *
 * What IS true: every capability named in `features` exists in the product and
 * is documented. What is undecided is which tier gets how much of it.
 */

/** Starts every plan from "nothing decided", so a forgotten key is visible. */
function undecidedLimits(): Record<EntitlementKey, PlanLimit> {
  return Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, { kind: "undecided" }])) as Record<EntitlementKey, PlanLimit>;
}

export const PLANS: ReadonlyArray<Plan> = [
  {
    id: "starter",
    name: "Starter",
    description: "For trying the product properly: build a chatbot, ground it in your own content, and put it on a page.",
    status: "draft",
    price: { monthly: { kind: "free" }, yearly: { kind: "free" } },
    cta: { label: "Create a workspace", href: "/sign-up" as Route },
    features: [
      { label: "Build chatbots and put them on your website", docsHref: "/docs/chatbots" as Route },
      { label: "Ground answers in your own knowledge base", docsHref: "/docs/knowledge-base" as Route },
      { label: "Test in the playground before publishing", docsHref: "/docs/chatbots" as Route },
      { label: "Conversation inbox with AI summaries", docsHref: "/docs/conversations" as Route },
    ],
    limits: {
      ...undecidedLimits(),
      apiAccess: { kind: "unavailable" },
      integrations: { kind: "unavailable" },
    },
  },
  {
    id: "team",
    name: "Team",
    description: "For putting it in front of customers: API access, integrations, and room for a team to work in one workspace.",
    status: "draft",
    highlighted: true,
    price: { monthly: { kind: "undecided" }, yearly: { kind: "undecided" } },
    cta: { label: "Create a workspace", href: "/sign-up" as Route },
    features: [
      { label: "Everything in Starter" },
      { label: "Call chatbots from your own code with an API key", docsHref: "/docs/api/authentication" as Route },
      { label: "Agents with tool calls surfaced for review", docsHref: "/docs/agents" as Route },
      { label: "Automate with workflows", docsHref: "/docs/workflows" as Route },
      { label: "CRM with contacts, notes and activity", docsHref: "/docs/crm" as Route },
      { label: "Connect the tools you already use", docsHref: "/docs/integrations" as Route },
    ],
    limits: {
      ...undecidedLimits(),
      apiAccess: { kind: "included" },
      integrations: { kind: "included" },
    },
  },
  {
    id: "scale",
    name: "Scale",
    description: "For higher volume and tighter requirements. Priced against what you actually need.",
    status: "draft",
    price: {
      monthly: { kind: "contact", label: "Talk to us" },
      yearly: { kind: "contact", label: "Talk to us" },
    },
    cta: { label: "Get in touch", href: "/sign-up" as Route },
    features: [
      { label: "Everything in Team" },
      { label: "Higher usage ceilings" },
      { label: "Volume and retention terms agreed in writing" },
    ],
    limits: {
      ...undecidedLimits(),
      apiAccess: { kind: "included" },
      integrations: { kind: "included" },
      messagesPerMonth: { kind: "custom", label: "Agreed" },
      tokensPerMonth: { kind: "custom", label: "Agreed" },
      workflowRunsPerMonth: { kind: "custom", label: "Agreed" },
    },
  },
];

/** Row order and wording for the comparison table. */
export const ENTITLEMENT_LABELS: Record<EntitlementKey, string> = {
  chatbots: "Chatbots",
  agents: "Agents",
  workflows: "Workflows",
  knowledgeBases: "Knowledge bases",
  knowledgeSources: "Sources per knowledge base",
  members: "Workspace members",
  apiAccess: "API access",
  crmContacts: "CRM contacts",
  integrations: "Integrations",
  messagesPerMonth: "Messages per month",
  tokensPerMonth: "Tokens per month",
  workflowRunsPerMonth: "Workflow runs per month",
};

/** Grouping for the comparison table, so it reads as a product, not a list. */
export const ENTITLEMENT_GROUPS: ReadonlyArray<{ title: string; keys: EntitlementKey[] }> = [
  { title: "Build", keys: ["chatbots", "agents", "workflows", "knowledgeBases", "knowledgeSources"] },
  { title: "Connect", keys: ["apiAccess", "integrations", "crmContacts", "members"] },
  { title: "Usage", keys: ["messagesPerMonth", "tokensPerMonth", "workflowRunsPerMonth"] },
];

export function findPlan(id: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

/**
 * Whether pricing has been settled.
 *
 * The page reads this to decide whether to show the draft notice, so the
 * notice disappears by itself once the plans are published rather than
 * lingering because someone forgot to delete it.
 */
export function pricingIsDraft(plans: ReadonlyArray<Plan> = PLANS): boolean {
  return plans.some((plan) => plan.status === "draft");
}
