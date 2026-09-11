import type { BillingInterval, Plan } from "@/features/pricing/types";

const INTERVAL_SUFFIX: Record<BillingInterval, string> = {
  monthly: "per month",
  yearly: "per year",
};

/**
 * The price, or a visible admission that there isn't one yet.
 *
 * An undecided price renders as a marked gap, not as a number and not as a
 * dash that could be mistaken for "free". This is the same treatment the legal
 * pages give an unresolved value, and for the same reason: a page that looks
 * finished while it is not is harder to catch than one that says so.
 */
export function PlanPrice({ plan, interval }: { plan: Plan; interval: BillingInterval }) {
  const price = plan.price[interval];

  if (price.kind === "free") {
    return (
      <p className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight text-foreground">Free</span>
        <span className="text-sm text-foreground-muted">while in early access</span>
      </p>
    );
  }

  if (price.kind === "contact") {
    return (
      <p className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight text-foreground">{price.label}</span>
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-baseline gap-2">
      <mark className="rounded-md border border-warning-border bg-warning-bg px-2 py-1 text-sm font-medium text-foreground">
        <span className="sr-only">Price not set yet: </span>
        Price to be confirmed
      </mark>
      <span className="text-sm text-foreground-subtle">{INTERVAL_SUFFIX[interval]}</span>
    </p>
  );
}
