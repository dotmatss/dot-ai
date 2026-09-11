import { Gauge } from "lucide-react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppBadge } from "@/components/ui/app-badge";
import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableRow,
} from "@/components/ui/app-table";
import { AnalyticsSection } from "@/features/analytics/components/analytics-section";
import { CURRENT_PLAN, PERIOD_META, USAGE_KIND_META } from "@/features/analytics/constants";
import { getUsageTotals } from "@/features/analytics/server/analytics-service";
import { USAGE_KINDS, type AnalyticsPeriod } from "@/features/analytics/types";
import { formatNumber } from "@/lib/format/number";

export async function AnalyticsUsageTotals({ workspaceId, period }: { workspaceId: string; period: AnalyticsPeriod }) {
  const totals = await getUsageTotals(workspaceId, period);
  const days = PERIOD_META[period].days;
  const metered = USAGE_KINDS.reduce((sum, kind) => sum + totals[kind], 0);

  return (
    <AnalyticsSection
      title="Metered usage"
      description={`Everything recorded against this workspace in the last ${days} days.`}
      aside={<AppBadge tone="neutral">{CURRENT_PLAN.name} plan</AppBadge>}
      contentClassName="gap-4"
    >
      {metered === 0 ? (
        <AppEmptyState
          size="sm"
          icon={<Gauge aria-hidden />}
          title="Nothing metered in this window"
          description="Messages, tokens, workflow runs, embeddings and retrievals are recorded as they happen and totalled here."
        />
      ) : (
        <AppTableContainer>
          <AppTable>
            <AppTableHeader>
              <AppTableRow>
                <AppTableHead>Metric</AppTableHead>
                <AppTableHead className="text-right">Last {days} days</AppTableHead>
              </AppTableRow>
            </AppTableHeader>
            <AppTableBody>
              {USAGE_KINDS.map((kind) => (
                <AppTableRow key={kind}>
                  <AppTableCell>
                    <span className="font-medium">{USAGE_KIND_META[kind].label}</span>
                    <span className="block text-xs text-foreground-muted">{USAGE_KIND_META[kind].description}</span>
                  </AppTableCell>
                  <AppTableCell className="text-right tabular-nums">{formatNumber(totals[kind])}</AppTableCell>
                </AppTableRow>
              ))}
            </AppTableBody>
          </AppTable>
        </AppTableContainer>
      )}
      <p className="text-xs text-foreground-muted">{CURRENT_PLAN.description}</p>
    </AnalyticsSection>
  );
}
