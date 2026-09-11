import { ArrowUpRight, Check } from "lucide-react";

import { AppBadge } from "@/components/ui/app-badge";
import { AppButtonLink } from "@/components/ui/app-button";
import { PlanPrice } from "@/features/pricing/components/plan-price";
import type { BillingInterval, Plan } from "@/features/pricing/types";
import { cn } from "@/lib/cn";

/**
 * One plan.
 *
 * Presentational only: it reads a `Plan` and renders it. No pricing rule, no
 * interval arithmetic and no entitlement logic lives here, so changing the
 * catalogue never means editing a component.
 */
export function PricingCard({ plan, interval }: { plan: Plan; interval: BillingInterval }) {
  return (
    <article
      className={cn(
        "flex h-full flex-col rounded-xl border bg-surface p-6 shadow-xs",
        plan.highlighted ? "border-foreground shadow-md" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold tracking-tight text-foreground">{plan.name}</h3>
        {plan.highlighted ? (
          <AppBadge tone="inverted" size="sm">
            Most complete
          </AppBadge>
        ) : null}
      </div>

      <p className="mt-2 min-h-[3.5rem] text-sm leading-6 text-foreground-muted">{plan.description}</p>

      <div className="mt-4 min-h-[3.25rem]">
        <PlanPrice plan={plan} interval={interval} />
      </div>

      <AppButtonLink
        href={plan.cta.href}
        variant={plan.highlighted ? "primary" : "secondary"}
        fullWidth
        className="mt-6"
      >
        {plan.cta.label}
      </AppButtonLink>

      <ul className="mt-6 flex flex-col gap-2.5 border-t border-border pt-6">
        {plan.features.map((feature) => (
          <li key={feature.label} className="flex gap-2.5 text-sm leading-6 text-foreground-secondary">
            <Check aria-hidden className="mt-1 size-4 shrink-0 text-foreground" />
            {feature.docsHref ? (
              <a
                href={feature.docsHref}
                className="group inline-flex items-start gap-1 rounded-xs hover:text-foreground focus-ring"
              >
                {feature.label}
                <ArrowUpRight
                  aria-hidden
                  className="mt-1 size-3 shrink-0 text-foreground-subtle transition-colors group-hover:text-foreground"
                />
              </a>
            ) : (
              <span>{feature.label}</span>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}
