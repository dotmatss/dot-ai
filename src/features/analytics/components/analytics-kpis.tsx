import { AppStat } from "@/components/ui/app-stat";
import { PERIOD_META } from "@/features/analytics/constants";
import { comparisonDelta, shareOfTotal } from "@/features/analytics/metrics";
import { getAnalyticsKpis } from "@/features/analytics/server/analytics-service";
import type { AnalyticsPeriod, MetricComparison } from "@/features/analytics/types";
import { formatCompactNumber, formatNumber, formatPercent } from "@/lib/format/number";

/** Compact for the headline, exact in the title - a 3xl figure must not wrap. */
function statValue(value: number) {
  return <span title={formatNumber(value)}>{formatCompactNumber(value)}</span>;
}

function previousHint(comparison: MetricComparison) {
  return <span className="text-xs tabular-nums text-foreground-muted">was {formatCompactNumber(comparison.previous)}</span>;
}

export async function AnalyticsKpis({ workspaceId, period }: { workspaceId: string; period: AnalyticsPeriod }) {
  const kpis = await getAnalyticsKpis(workspaceId, period);
  const deltaLabel = `vs previous ${PERIOD_META[period].days} days`;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <AppStat
        label="Conversations"
        value={statValue(kpis.conversations.current)}
        delta={comparisonDelta(kpis.conversations)}
        deltaLabel={deltaLabel}
        hint={previousHint(kpis.conversations)}
      />
      <AppStat
        label="Visitor messages"
        value={statValue(kpis.visitorMessages.current)}
        delta={comparisonDelta(kpis.visitorMessages)}
        deltaLabel={deltaLabel}
        hint={previousHint(kpis.visitorMessages)}
      />
      <AppStat
        label="Resolved conversations"
        value={statValue(kpis.resolvedConversations.current)}
        delta={comparisonDelta(kpis.resolvedConversations)}
        deltaLabel={deltaLabel}
        hint={
          <span className="text-xs tabular-nums text-foreground-muted">
            {formatPercent(shareOfTotal(kpis.resolvedConversations.current, kpis.conversations.current))} of all
          </span>
        }
      />
      <AppStat
        label="Tokens"
        value={statValue(kpis.tokens.current)}
        delta={comparisonDelta(kpis.tokens)}
        deltaLabel={deltaLabel}
        hint={
          <span className="text-xs tabular-nums text-foreground-muted">
            {formatCompactNumber(kpis.tokensIn)} in · {formatCompactNumber(kpis.tokensOut)} out
          </span>
        }
      />
    </div>
  );
}
