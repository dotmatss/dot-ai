import { Coins } from "lucide-react";

import { AppBarChart } from "@/components/charts/app-bar-chart";
import { AppEmptyState } from "@/components/feedback/app-empty-state";
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
import { AnalyticsSection } from "@/features/analytics/components/analytics-section";
import { PERIOD_META, TOKEN_TABLE_LIMIT } from "@/features/analytics/constants";
import { shareOfTotal } from "@/features/analytics/metrics";
import { formatBucketLabel } from "@/features/analytics/series";
import { getTokenUsage } from "@/features/analytics/server/analytics-service";
import type { AnalyticsPeriod } from "@/features/analytics/types";
import { formatCompactNumber, formatNumber, formatPercent } from "@/lib/format/number";

export async function AnalyticsTokenUsage({ workspaceId, period }: { workspaceId: string; period: AnalyticsPeriod }) {
  const usage = await getTokenUsage(workspaceId, period);
  const days = PERIOD_META[period].days;
  const total = usage.totalIn + usage.totalOut;

  const data = usage.series.map((bucket) => ({
    label: formatBucketLabel(bucket.start),
    value: bucket.tokensIn,
    compare: bucket.tokensOut,
  }));

  // The table is the chatbot slice of the total: agent and workflow spend is
  // metered under its own ref_type, so these rows need not sum to the headline.
  const chatbotTotal = usage.byChatbot.reduce((sum, row) => sum + row.tokensIn + row.tokensOut, 0);

  return (
    <AnalyticsSection
      title="Token usage"
      description={`Prompt and completion tokens per ${usage.bucket} over the last ${days} days.`}
      aside={
        <dl className="flex gap-6 text-left text-xs">
          <div>
            <dt className="text-foreground-muted">Tokens in</dt>
            <dd className="text-sm font-semibold tabular-nums" title={formatNumber(usage.totalIn)}>
              {formatCompactNumber(usage.totalIn)}
            </dd>
          </div>
          <div>
            <dt className="text-foreground-muted">Tokens out</dt>
            <dd className="text-sm font-semibold tabular-nums" title={formatNumber(usage.totalOut)}>
              {formatCompactNumber(usage.totalOut)}
            </dd>
          </div>
        </dl>
      }
      contentClassName="gap-6"
    >
      {total === 0 ? (
        <AppEmptyState
          icon={<Coins aria-hidden />}
          title="No tokens used in this window"
          description="Every model call records the tokens it spent. Once your chatbots and agents answer, spend shows up here per day and per chatbot."
        />
      ) : (
        <>
          {/* No `formatValue`: this is a Server Component and AppBarChart is a
              Client Component, so a function cannot cross the boundary. The
              chart already defaults to the same `formatNumber`, which is why
              passing it was both redundant and fatal - and why the crash only
              appeared once a workspace had token usage to draw. */}
          <AppBarChart
            data={data}
            title={`Tokens in and tokens out per ${usage.bucket}, last ${days} days`}
            valueLabel="Tokens in"
            compareLabel="Tokens out"
            height={220}
          />
          {usage.byChatbot.length === 0 ? (
            <p className="text-sm text-foreground-muted">
              None of this spend is attributed to a chatbot - it came from agents, workflows or knowledge processing.
            </p>
          ) : (
            <AppTableContainer>
              <AppTable>
                <AppTableCaption>
                  Chatbot token spend in the last {days} days, top {TOKEN_TABLE_LIMIT}. Agent and workflow spend is
                  metered separately and is not included.
                </AppTableCaption>
                <AppTableHeader>
                  <AppTableRow>
                    <AppTableHead>Chatbot</AppTableHead>
                    <AppTableHead className="text-right">Tokens in</AppTableHead>
                    <AppTableHead className="text-right">Tokens out</AppTableHead>
                    <AppTableHead className="text-right">Total</AppTableHead>
                    <AppTableHead className="text-right">Share</AppTableHead>
                  </AppTableRow>
                </AppTableHeader>
                <AppTableBody>
                  {usage.byChatbot.map((row) => {
                    const rowTotal = row.tokensIn + row.tokensOut;
                    return (
                      <AppTableRow key={row.chatbotId}>
                        <AppTableCell className="font-medium">
                          {row.name ?? <span className="text-foreground-muted">Deleted chatbot</span>}
                        </AppTableCell>
                        <AppTableCell className="text-right tabular-nums">{formatNumber(row.tokensIn)}</AppTableCell>
                        <AppTableCell className="text-right tabular-nums">{formatNumber(row.tokensOut)}</AppTableCell>
                        <AppTableCell className="text-right tabular-nums">{formatNumber(rowTotal)}</AppTableCell>
                        <AppTableCell className="text-right tabular-nums text-foreground-muted">
                          {formatPercent(shareOfTotal(rowTotal, chatbotTotal))}
                        </AppTableCell>
                      </AppTableRow>
                    );
                  })}
                </AppTableBody>
              </AppTable>
            </AppTableContainer>
          )}
        </>
      )}
    </AnalyticsSection>
  );
}
