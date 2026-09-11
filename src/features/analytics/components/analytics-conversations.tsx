import { MessagesSquare } from "lucide-react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { PERIOD_META } from "@/features/analytics/constants";
import { AnalyticsAreaChart, type AnalyticsChartPoint } from "@/features/analytics/components/analytics-area-chart";
import { AnalyticsDelta } from "@/features/analytics/components/analytics-delta";
import { AnalyticsSection } from "@/features/analytics/components/analytics-section";
import { deltaPercent, seriesMax, seriesTotal } from "@/features/analytics/metrics";
import { alignSeries, formatBucketLabel, formatBucketRange } from "@/features/analytics/series";
import { getConversationSeries } from "@/features/analytics/server/analytics-service";
import type { AnalyticsPeriod } from "@/features/analytics/types";
import { formatNumber } from "@/lib/format/number";

export async function AnalyticsConversations({ workspaceId, period }: { workspaceId: string; period: AnalyticsPeriod }) {
  const series = await getConversationSeries(workspaceId, period);

  const currentTotal = seriesTotal(series.current);
  const previousTotal = seriesTotal(series.previous);
  const days = PERIOD_META[period].days;

  // The two series share one axis, so the taller of the two sets the scale.
  const max = Math.max(seriesMax(series.current), seriesMax(series.previous));
  const points: AnalyticsChartPoint[] = alignSeries(series.current, series.previous).map((bucket) => ({
    key: bucket.start,
    label: formatBucketLabel(bucket.start),
    rangeLabel: formatBucketRange(bucket.start, series.bucket),
    current: bucket.current,
    previous: bucket.previous,
    previousRangeLabel: bucket.previousStart ? formatBucketRange(bucket.previousStart, series.bucket) : null,
  }));

  return (
    <AnalyticsSection
      title="Conversations over time"
      description={`${series.bucket === "week" ? "Weekly" : "Daily"} conversations, against the ${days} days before this window.`}
      aside={
        <>
          <p className="text-2xl font-semibold tabular-nums">{formatNumber(currentTotal)}</p>
          <AnalyticsDelta delta={deltaPercent(currentTotal, previousTotal)} previous={previousTotal} />
        </>
      }
    >
      {currentTotal === 0 && previousTotal === 0 ? (
        <AppEmptyState
          icon={<MessagesSquare aria-hidden />}
          title="No conversations yet"
          description="Once a chatbot, agent or API client starts a conversation, its volume appears here day by day."
        />
      ) : (
        <AnalyticsAreaChart
          id="analytics-conversations"
          title={`Conversations per ${series.bucket}, last ${days} days compared with the ${days} days before`}
          points={points}
          currentLabel="This period"
          previousLabel="Previous period"
          max={max}
        />
      )}
    </AnalyticsSection>
  );
}
