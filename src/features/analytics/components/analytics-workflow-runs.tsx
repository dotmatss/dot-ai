import { Workflow } from "lucide-react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppProgressCircle } from "@/components/ui/app-progress";
import { AnalyticsDelta } from "@/features/analytics/components/analytics-delta";
import { AnalyticsSection } from "@/features/analytics/components/analytics-section";
import { PERIOD_META } from "@/features/analytics/constants";
import { deltaPercent, successRate } from "@/features/analytics/metrics";
import { getWorkflowRunsSummary } from "@/features/analytics/server/analytics-service";
import type { AnalyticsPeriod } from "@/features/analytics/types";
import { formatNumber, formatPercent } from "@/lib/format/number";

export async function AnalyticsWorkflowRuns({ workspaceId, period }: { workspaceId: string; period: AnalyticsPeriod }) {
  const runs = await getWorkflowRunsSummary(workspaceId, period);
  const days = PERIOD_META[period].days;

  const rate = successRate(runs.succeeded, runs.total);
  const previousRate = successRate(runs.previousSucceeded, runs.previousTotal);
  // Anything neither succeeded nor failed is still running, queued, cancelled
  // or waiting for an approval - counted, not guessed at.
  const unsettled = Math.max(0, runs.total - runs.succeeded - runs.failed);

  const breakdown = [
    { label: "Succeeded", value: runs.succeeded },
    { label: "Failed", value: runs.failed },
    { label: "Other outcomes", value: unsettled },
  ];

  return (
    <AnalyticsSection
      title="Workflow runs"
      description={`Outcomes of the runs started in the last ${days} days.`}
      aside={
        <>
          <p className="text-2xl font-semibold tabular-nums">{formatNumber(runs.total)}</p>
          <AnalyticsDelta delta={deltaPercent(runs.total, runs.previousTotal)} previous={runs.previousTotal} />
        </>
      }
    >
      {runs.total === 0 && runs.previousTotal === 0 ? (
        <AppEmptyState
          size="sm"
          icon={<Workflow aria-hidden />}
          title="No workflow runs yet"
          description="Run a workflow and its success rate, failures and volume are tracked here."
        />
      ) : (
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <AppProgressCircle value={rate} label={`Workflow success rate, last ${days} days`} size={72} />
            <div>
              <p className="text-sm font-medium">Success rate</p>
              <p className="text-xs text-foreground-muted">
                {runs.previousTotal === 0
                  ? "No runs in the previous period"
                  : `${formatPercent(previousRate)} in the previous period`}
              </p>
            </div>
          </div>
          <dl className="grid flex-1 grid-cols-3 gap-4 text-sm">
            {breakdown.map((item) => (
              <div key={item.label} className="min-w-0">
                <dt className="truncate text-xs text-foreground-muted">{item.label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatNumber(item.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </AnalyticsSection>
  );
}
