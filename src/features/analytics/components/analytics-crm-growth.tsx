import { Users } from "lucide-react";

import { AppSparkline } from "@/components/charts/app-sparkline";
import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AnalyticsDelta } from "@/features/analytics/components/analytics-delta";
import { AnalyticsSection } from "@/features/analytics/components/analytics-section";
import { PERIOD_META } from "@/features/analytics/constants";
import { deltaPercent } from "@/features/analytics/metrics";
import { formatBucketRange } from "@/features/analytics/series";
import { getCrmGrowth } from "@/features/analytics/server/analytics-service";
import type { AnalyticsPeriod } from "@/features/analytics/types";
import { formatNumber } from "@/lib/format/number";

export async function AnalyticsCrmGrowth({ workspaceId, period }: { workspaceId: string; period: AnalyticsPeriod }) {
  const crm = await getCrmGrowth(workspaceId, period);
  const days = PERIOD_META[period].days;
  const values = crm.series.map((bucket) => bucket.value);

  return (
    <AnalyticsSection
      title="Contacts"
      description={`New contacts per ${crm.bucket} over the last ${days} days.`}
      aside={
        <>
          <p className="text-2xl font-semibold tabular-nums">{formatNumber(crm.totalContacts)}</p>
          <p className="text-xs text-foreground-muted">contacts in total</p>
        </>
      }
    >
      {crm.totalContacts === 0 ? (
        <AppEmptyState
          size="sm"
          icon={<Users aria-hidden />}
          title="No contacts yet"
          description="Contacts are created from conversations, workflows or by hand, and their growth is charted here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs text-foreground-muted">New in this period</p>
              <p className="text-3xl font-semibold tabular-nums">{formatNumber(crm.newContacts)}</p>
              <AnalyticsDelta
                delta={deltaPercent(crm.newContacts, crm.previousNewContacts)}
                previous={crm.previousNewContacts}
                className="mt-1"
              />
            </div>
            {values.length >= 2 ? (
              <AppSparkline
                values={values}
                width={160}
                height={48}
                label={`New contacts per ${crm.bucket} over the last ${days} days`}
              />
            ) : null}
          </div>
          <table className="sr-only">
            <caption>New contacts per {crm.bucket} over the last {days} days</caption>
            <thead>
              <tr>
                <th scope="col">Bucket</th>
                <th scope="col">New contacts</th>
              </tr>
            </thead>
            <tbody>
              {crm.series.map((bucket) => (
                <tr key={bucket.start}>
                  <th scope="row">{formatBucketRange(bucket.start, crm.bucket)}</th>
                  <td>{formatNumber(bucket.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsSection>
  );
}
