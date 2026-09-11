import { Bot } from "lucide-react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AnalyticsBarRows, type AnalyticsBarRow } from "@/features/analytics/components/analytics-bar-rows";
import { AnalyticsSection } from "@/features/analytics/components/analytics-section";
import { PERIOD_META, TOP_CHATBOTS_LIMIT } from "@/features/analytics/constants";
import { rankWithOther } from "@/features/analytics/metrics";
import { getMessagesByChatbot } from "@/features/analytics/server/analytics-service";
import type { AnalyticsPeriod } from "@/features/analytics/types";
import { formatNumber } from "@/lib/format/number";

/** Conversations with no chatbot share one row, so they need a stable key. */
const NO_CHATBOT_ID = "__no_chatbot__";

export async function AnalyticsMessagesByChatbot({
  workspaceId,
  period,
}: {
  workspaceId: string;
  period: AnalyticsPeriod;
}) {
  const rows = await getMessagesByChatbot(workspaceId, period);
  const total = rows.reduce((sum, row) => sum + row.messages, 0);

  // Past the limit the tail is collapsed rather than dropped, so the bars still
  // add up to the total a reader can see in the header.
  const ranked: AnalyticsBarRow[] = rankWithOther(
    rows.map((row) => ({ id: row.chatbotId ?? NO_CHATBOT_ID, label: row.name, value: row.messages })),
    TOP_CHATBOTS_LIMIT,
  );

  return (
    <AnalyticsSection
      title="Messages by chatbot"
      description={`Visitor and assistant messages in the last ${PERIOD_META[period].days} days. Beyond the top ${TOP_CHATBOTS_LIMIT}, the rest are grouped as Other.`}
      aside={
        <>
          <p className="text-2xl font-semibold tabular-nums">{formatNumber(total)}</p>
          <p className="text-xs text-foreground-muted">messages</p>
        </>
      }
    >
      {ranked.length === 0 || total === 0 ? (
        <AppEmptyState
          size="sm"
          icon={<Bot aria-hidden />}
          title="No messages yet"
          description="Message volume is split per chatbot as soon as your chatbots start answering."
        />
      ) : (
        <AnalyticsBarRows rows={ranked} total={total} valueLabel="messages" />
      )}
    </AnalyticsSection>
  );
}
