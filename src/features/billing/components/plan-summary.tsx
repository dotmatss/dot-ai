import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppCard } from "@/components/ui/app-card";
import { AppHeading, AppText } from "@/components/ui/app-typography";
import { SUBSCRIPTION_STATUS_META } from "@/features/billing/constants";
import type { BillingOverview } from "@/features/billing/types";
import { formatDate } from "@/lib/format/date";

/**
 * What plan this workspace is on, and - just as important - whether anything is
 * being enforced because of it.
 *
 * The unassigned state is not dressed up as a free tier. A workspace nobody has
 * put on a plan has no limits, and saying "Free" here would imply a decision
 * that was never made and limits that are not applied.
 */
export function PlanSummary({ overview }: { overview: BillingOverview }) {
  const { subscription } = overview;
  const period = `${formatDate(overview.periodStart)} – ${formatDate(overview.periodEnd)}`;

  if (!subscription) {
    return (
      <section className="flex flex-col gap-3">
        <AppHeading level={2} className="text-lg">
          Plan
        </AppHeading>
        <AppCard padding="md" className="flex flex-col gap-2">
          <span className="flex items-center gap-2">
            <AppBadge tone="neutral">No plan</AppBadge>
            <AppText size="sm" tone="muted">
              This workspace has not been put on a plan.
            </AppText>
          </span>
          <AppText size="sm" tone="muted">
            Nothing is limited or charged. Usage is still metered, and is reported below for the current calendar month
            ({period}).
          </AppText>
        </AppCard>
      </section>
    );
  }

  const status = SUBSCRIPTION_STATUS_META[subscription.status];

  return (
    <section className="flex flex-col gap-3">
      <AppHeading level={2} className="text-lg">
        Plan
      </AppHeading>
      <AppCard padding="md" className="flex flex-col gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <AppBadge tone="inverted">{subscription.planName ?? subscription.planId}</AppBadge>
          <AppBadge tone={status.tone}>{status.label}</AppBadge>
          {subscription.cancelAtPeriodEnd ? <AppBadge tone="warning">Ends at period end</AppBadge> : null}
        </span>
        <AppText size="sm" tone="muted">
          {status.description}
        </AppText>
        <AppText size="sm" tone="muted">
          Current period {period}
          {subscription.assignedByName ? ` · assigned by ${subscription.assignedByName}` : null}
        </AppText>
      </AppCard>

      {/*
        A plan id with nothing behind it in the catalogue. Enforcement stops
        rather than guessing, so this has to be visible: it is an operator
        problem, not something the reader can fix from this page.
      */}
      {!subscription.planKnown ? (
        <AppAlert tone="warning" title="This plan is not in the catalogue">
          The stored plan <code className="font-mono text-xs">{subscription.planId}</code> no longer exists in the
          pricing catalogue, so no limits are being applied. Assign a current plan to restore enforcement.
        </AppAlert>
      ) : null}

      {overview.catalogueIsDraft ? (
        <AppAlert tone="neutral" title="Pricing is still a draft">
          Plans exist and can be assigned, but their prices and most of their limits have not been decided. Only the
          limits marked below as decided are enforced, and nothing is charged.
        </AppAlert>
      ) : null}
    </section>
  );
}
