import { Fragment } from "react";

import { AppBadge } from "@/components/ui/app-badge";
import { AppProgressBar } from "@/components/ui/app-progress";
import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableRow,
} from "@/components/ui/app-table";
import { AppHeading, AppText } from "@/components/ui/app-typography";
import { ENTITLEMENT_REASON_META } from "@/features/billing/constants";
import type { EntitlementSummary } from "@/features/billing/types";
import { ENTITLEMENT_GROUPS } from "@/features/pricing/plans";
import type { PlanLimit } from "@/features/pricing/types";
import { formatNumber } from "@/lib/format/number";

/**
 * What the plan says about one capability, in the same words the pricing page
 * uses. An undecided limit renders as a visible gap rather than a zero - the
 * convention `PlanLimit` was designed around.
 */
function describeLimit(limit: PlanLimit): string {
  switch (limit.kind) {
    case "undecided":
      return "Not decided";
    case "included":
      return "Included";
    case "unavailable":
      return "Not included";
    case "unlimited":
      return "Unlimited";
    case "custom":
      return limit.label;
    case "count":
      return formatNumber(limit.value);
  }
}

/**
 * The usage cell.
 *
 * Three different things can be true here, and collapsing them would mislead:
 * a metered key with a decided number gets a bar against that number; a metered
 * key with no decided limit still reports what was consumed; everything else
 * has nothing to show, because this feature does not count another feature's
 * rows (see `METERED_ENTITLEMENT_KINDS`).
 */
function UsageCell({ entitlement }: { entitlement: EntitlementSummary }) {
  if (entitlement.usage) {
    const { current, limit } = entitlement.usage;
    const tone = current >= limit ? "danger" : current / limit >= 0.8 ? "warning" : "default";
    return (
      <span className="flex items-center gap-3">
        <span aria-hidden className="hidden min-w-0 flex-1 sm:block">
          <AppProgressBar value={current} max={limit} label={entitlement.label} size="sm" tone={tone} />
        </span>
        <span className="w-32 shrink-0 text-right font-medium tabular-nums">
          {formatNumber(current)} / {formatNumber(limit)}
        </span>
      </span>
    );
  }

  if (entitlement.metered && entitlement.periodUsage !== null) {
    return (
      <span className="flex items-center justify-end gap-2">
        <span className="font-medium tabular-nums">{formatNumber(entitlement.periodUsage)}</span>
        <span className="text-xs text-foreground-muted">used</span>
      </span>
    );
  }

  return <span className="text-foreground-muted">—</span>;
}

/**
 * The entitlement matrix.
 *
 * `enforced` drives the emphasis, not `allowed`. Most rows today are allowed
 * only because nothing has been decided, and rendering those the same as a real
 * grant would turn an empty business model into a set of promises.
 */
export function EntitlementTable({ entitlements }: { entitlements: EntitlementSummary[] }) {
  const byKey = new Map(entitlements.map((entitlement) => [entitlement.key, entitlement]));

  return (
    <section className="flex flex-col gap-3">
      <div>
        <AppHeading level={2} className="text-lg">
          What this plan allows
        </AppHeading>
        <AppText size="sm" tone="muted">
          Only limits marked as decided are enforced. Everything else is permitted because no limit has been set, not
          because the plan grants it.
        </AppText>
      </div>

      <AppTableContainer>
        <AppTable>
          <AppTableHeader>
            <AppTableRow>
              <AppTableHead>Capability</AppTableHead>
              <AppTableHead>Plan</AppTableHead>
              <AppTableHead className="text-right">This period</AppTableHead>
              <AppTableHead className="text-right">State</AppTableHead>
            </AppTableRow>
          </AppTableHeader>
          <AppTableBody>
            {ENTITLEMENT_GROUPS.map((group) => (
              <Fragment key={group.title}>
                <AppTableRow>
                  <AppTableCell colSpan={4} className="bg-surface-muted text-xs font-medium uppercase tracking-wide text-foreground-muted">
                    {group.title}
                  </AppTableCell>
                </AppTableRow>
                {group.keys.map((key) => {
                  const entitlement = byKey.get(key);
                  if (!entitlement) return null;
                  const reason = ENTITLEMENT_REASON_META[entitlement.reason];
                  return (
                    <AppTableRow key={key}>
                      <AppTableCell className="font-medium text-foreground">{entitlement.label}</AppTableCell>
                      <AppTableCell className="text-foreground-muted">{describeLimit(entitlement.limit)}</AppTableCell>
                      <AppTableCell className="text-right">
                        <UsageCell entitlement={entitlement} />
                      </AppTableCell>
                      <AppTableCell className="text-right">
                        <AppBadge tone={reason.tone} variant={entitlement.enforced ? "soft" : "outline"}>
                          {reason.label}
                        </AppBadge>
                      </AppTableCell>
                    </AppTableRow>
                  );
                })}
              </Fragment>
            ))}
          </AppTableBody>
        </AppTable>
      </AppTableContainer>
    </section>
  );
}
