import { Gauge } from "lucide-react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppBadge } from "@/components/ui/app-badge";
import { AppCard } from "@/components/ui/app-card";
import { AppProgressBar } from "@/components/ui/app-progress";
import {
  AppTable,
  AppTableBody,
  AppTableCaption,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableRow,
} from "@/components/ui/app-table";
import { AppHeading, AppText } from "@/components/ui/app-typography";
import { USAGE_KIND_META } from "@/features/analytics/constants";
import { USAGE_KINDS, type UsageKind } from "@/features/analytics/types";
import type { UsageKindTotal, WorkspaceUsageSummary } from "@/features/settings/types";
import { formatDate } from "@/lib/format/date";
import { formatNumber } from "@/lib/format/number";

/**
 * `usage_events.kind` is free text, so a kind the product has not named yet is
 * still reported - under its raw value rather than being dropped. Known kinds
 * are labelled from the analytics feature, which owns that vocabulary.
 */
function isKnownKind(kind: string): kind is UsageKind {
  return (USAGE_KINDS as ReadonlyArray<string>).includes(kind);
}

function describeKind(kind: string): { label: string; description: string | null } {
  return isKnownKind(kind) ? USAGE_KIND_META[kind] : { label: kind, description: null };
}

/**
 * Totals per kind differ by orders of magnitude - millions of tokens next to a
 * handful of workflow runs - so they share a row, not an axis: each bar is a
 * share of the largest kind and the exact number sits beside it. The bar is
 * decorative (`aria-hidden`) because that number is the real content.
 */
function UsageRow({ total, max }: { total: UsageKindTotal; max: number }) {
  const meta = describeKind(total.kind);
  return (
    <AppTableRow>
      <AppTableCell>
        <span className="block font-medium text-foreground">{meta.label}</span>
        {meta.description ? <span className="block text-xs text-foreground-muted">{meta.description}</span> : null}
      </AppTableCell>
      <AppTableCell>
        <span className="flex items-center gap-3">
          <span aria-hidden className="hidden min-w-0 flex-1 sm:block">
            <AppProgressBar value={total.total} max={max} label={meta.label} size="sm" />
          </span>
          <span className="w-28 shrink-0 text-right font-medium tabular-nums">{formatNumber(total.total)}</span>
        </span>
      </AppTableCell>
      <AppTableCell className="w-28 text-right tabular-nums text-foreground-muted">
        {formatNumber(total.events)}
      </AppTableCell>
    </AppTableRow>
  );
}

/**
 * The plan is passed in rather than read here: this is a presentational Server
 * Component in the settings feature, and the plan belongs to billing. The page
 * resolves it through `getPlanLabel()` and hands it over.
 */
export function UsageOverview({
  usage,
  plan,
}: {
  usage: WorkspaceUsageSummary;
  plan: { name: string; description: string };
}) {
  // Largest first: the bar is read against the top row, so the scale is obvious.
  const totals = [...usage.totals].sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...totals.map((total) => total.total));
  const range = `${formatDate(usage.periodStart)} – ${formatDate(usage.periodEnd)}`;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <AppHeading level={2} className="text-lg">
          Plan
        </AppHeading>
        <AppCard padding="md" className="flex flex-col gap-2">
          <span className="flex items-center gap-2">
            <AppBadge tone="inverted">{plan.name}</AppBadge>
            <AppText size="sm" tone="muted">
              {plan.description}
            </AppText>
          </span>
          <AppText size="sm" tone="muted">
            Nothing here is charged or invoiced: there is no payment processor in this system. What a plan does control
            is which limits apply, on the Billing tab.
          </AppText>
        </AppCard>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <AppHeading level={2} className="text-lg">
            Usage
          </AppHeading>
          <AppText size="sm" tone="muted">
            What this workspace metered over the last {usage.days} days ({range}).
          </AppText>
        </div>

        {totals.length === 0 ? (
          <AppTableContainer>
            <AppEmptyState
              icon={<Gauge aria-hidden />}
              title="Nothing metered yet"
              description="Usage appears here once this workspace answers a message, runs a workflow or processes a knowledge source."
            />
          </AppTableContainer>
        ) : (
          <AppTableContainer>
            <AppTable>
              <AppTableCaption>
                {formatNumber(usage.totalEvents)} metered events between {range}.
              </AppTableCaption>
              <AppTableHeader>
                <AppTableRow>
                  <AppTableHead>Type</AppTableHead>
                  <AppTableHead>Total</AppTableHead>
                  <AppTableHead className="text-right">Events</AppTableHead>
                </AppTableRow>
              </AppTableHeader>
              <AppTableBody>
                {totals.map((total) => (
                  <UsageRow key={total.kind} total={total} max={max} />
                ))}
              </AppTableBody>
            </AppTable>
          </AppTableContainer>
        )}
      </section>
    </div>
  );
}
