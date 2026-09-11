import { Check, Minus } from "lucide-react";
import { Fragment } from "react";

import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableRow,
} from "@/components/ui/app-table";
import { ENTITLEMENT_GROUPS, ENTITLEMENT_LABELS, PLANS } from "@/features/pricing/plans";
import type { Plan, PlanLimit } from "@/features/pricing/types";

/**
 * The full matrix.
 *
 * This is also the map between pricing and product: every row is an
 * `EntitlementKey`, and a future billing layer answers "may this workspace do
 * X" against the same keys. Which is why an undecided cell says so rather than
 * showing a dash that would read as "not included".
 */
function LimitCell({ limit }: { limit: PlanLimit }) {
  switch (limit.kind) {
    case "included":
      return (
        <>
          <Check aria-hidden className="size-4 text-foreground" />
          <span className="sr-only">Included</span>
        </>
      );
    case "unavailable":
      return (
        <>
          <Minus aria-hidden className="size-4 text-foreground-subtle" />
          <span className="sr-only">Not included</span>
        </>
      );
    case "unlimited":
      return <span className="text-sm text-foreground">Unlimited</span>;
    case "count":
      return <span className="text-sm tabular-nums text-foreground">{limit.value.toLocaleString()}</span>;
    case "custom":
      return <span className="text-sm text-foreground">{limit.label}</span>;
    default:
      return <span className="text-xs text-foreground-subtle">To be confirmed</span>;
  }
}

export function PlanComparison({ plans = PLANS }: { plans?: ReadonlyArray<Plan> }) {
  return (
    <section aria-labelledby="compare-plans">
      <h2 id="compare-plans" className="text-2xl font-bold tracking-tight text-foreground">
        Compare plans
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
        Every row here is a capability the product already has. What each plan includes is still being decided.
      </p>

      <AppTableContainer className="mt-6">
        <AppTable>
          <AppTableHeader>
            <AppTableRow>
              <AppTableHead className="w-[40%]">Capability</AppTableHead>
              {plans.map((plan) => (
                <AppTableHead key={plan.id} className="text-center">
                  {plan.name}
                </AppTableHead>
              ))}
            </AppTableRow>
          </AppTableHeader>
          <AppTableBody>
            {ENTITLEMENT_GROUPS.map((group) => (
              <Fragment key={group.title}>
                <AppTableRow>
                  <AppTableCell
                    colSpan={plans.length + 1}
                    className="bg-surface-muted text-caption font-medium uppercase tracking-[0.08em] text-foreground-muted"
                  >
                    {group.title}
                  </AppTableCell>
                </AppTableRow>
                {group.keys.map((key) => (
                  <AppTableRow key={key}>
                    <AppTableCell className="text-foreground-secondary">{ENTITLEMENT_LABELS[key]}</AppTableCell>
                    {plans.map((plan) => (
                      <AppTableCell key={plan.id} className="text-center">
                        <span className="inline-flex items-center justify-center">
                          <LimitCell limit={plan.limits[key]} />
                        </span>
                      </AppTableCell>
                    ))}
                  </AppTableRow>
                ))}
              </Fragment>
            ))}
          </AppTableBody>
        </AppTable>
      </AppTableContainer>
    </section>
  );
}
