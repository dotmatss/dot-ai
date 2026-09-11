import { Share2 } from "lucide-react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AnalyticsBarRows, type AnalyticsBarRow } from "@/features/analytics/components/analytics-bar-rows";
import { AnalyticsSection } from "@/features/analytics/components/analytics-section";
import { CHANNEL_META, PERIOD_META } from "@/features/analytics/constants";
import { getChannelMix } from "@/features/analytics/server/analytics-service";
import type { AnalyticsPeriod } from "@/features/analytics/types";
import { formatNumber } from "@/lib/format/number";

export async function AnalyticsChannelMix({ workspaceId, period }: { workspaceId: string; period: AnalyticsPeriod }) {
  const mix = await getChannelMix(workspaceId, period);
  const total = mix.reduce((sum, row) => sum + row.count, 0);

  // Every channel comes back, including the ones nobody used, so the mix reads
  // as a complete picture rather than a list of whatever happened to be busy.
  const rows: AnalyticsBarRow[] = mix.map((row) => ({
    id: row.channel,
    label: CHANNEL_META[row.channel].label,
    value: row.count,
    hint: CHANNEL_META[row.channel].description,
  }));

  return (
    <AnalyticsSection
      title="Channel mix"
      description={`Where conversations started in the last ${PERIOD_META[period].days} days.`}
      aside={
        <>
          <p className="text-2xl font-semibold tabular-nums">{formatNumber(total)}</p>
          <p className="text-xs text-foreground-muted">total</p>
        </>
      }
    >
      {total === 0 ? (
        <AppEmptyState
          size="sm"
          icon={<Share2 aria-hidden />}
          title="No conversations in this window"
          description="Deploy a chatbot to your site, or open the playground, and the split across channels shows up here."
        />
      ) : (
        <AnalyticsBarRows rows={rows} total={total} valueLabel="conversations" />
      )}
    </AnalyticsSection>
  );
}
