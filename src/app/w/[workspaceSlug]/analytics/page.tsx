import type { Metadata } from "next";
import { Suspense } from "react";

import { AppStatGridSkeleton } from "@/components/feedback/app-loading";
import { AnalyticsChannelMix } from "@/features/analytics/components/analytics-channel-mix";
import { AnalyticsConversations } from "@/features/analytics/components/analytics-conversations";
import { AnalyticsCrmGrowth } from "@/features/analytics/components/analytics-crm-growth";
import { AnalyticsKpis } from "@/features/analytics/components/analytics-kpis";
import { AnalyticsMessagesByChatbot } from "@/features/analytics/components/analytics-messages-by-chatbot";
import { AnalyticsCardSkeleton } from "@/features/analytics/components/analytics-skeletons";
import { AnalyticsTokenUsage } from "@/features/analytics/components/analytics-token-usage";
import { AnalyticsUsageTotals } from "@/features/analytics/components/analytics-usage-totals";
import { AnalyticsWorkflowRuns } from "@/features/analytics/components/analytics-workflow-runs";
import { parseAnalyticsFilters } from "@/features/analytics/filters";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Analytics" };

/**
 * Read-only server state: the period comes from the URL and every section is
 * rendered on the server, so there is no analytics endpoint and nothing to
 * fetch on the client.
 *
 * Each section is its own async Server Component behind its own Suspense
 * boundary, so one slow aggregate cannot hold up the rest of the page. The
 * boundaries are keyed on the period so switching windows shows the skeletons
 * again instead of stale numbers.
 */
export default async function AnalyticsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/analytics">) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const { period } = parseAnalyticsFilters(query);
  const section = { workspaceId: membership.workspace.id, period };

  return (
    <div className="flex flex-col gap-6">
      <Suspense key={`kpis-${period}`} fallback={<AppStatGridSkeleton />}>
        <AnalyticsKpis {...section} />
      </Suspense>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Suspense key={`conversations-${period}`} fallback={<AnalyticsCardSkeleton bodyClassName="h-56" />}>
            <AnalyticsConversations {...section} />
          </Suspense>
        </div>
        <Suspense key={`channels-${period}`} fallback={<AnalyticsCardSkeleton bodyClassName="h-56" />}>
          <AnalyticsChannelMix {...section} />
        </Suspense>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense key={`chatbots-${period}`} fallback={<AnalyticsCardSkeleton bodyClassName="h-56" />}>
          <AnalyticsMessagesByChatbot {...section} />
        </Suspense>
        <Suspense key={`workflows-${period}`} fallback={<AnalyticsCardSkeleton bodyClassName="h-32" />}>
          <AnalyticsWorkflowRuns {...section} />
        </Suspense>
      </div>

      <Suspense key={`tokens-${period}`} fallback={<AnalyticsCardSkeleton bodyClassName="h-72" />}>
        <AnalyticsTokenUsage {...section} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense key={`crm-${period}`} fallback={<AnalyticsCardSkeleton bodyClassName="h-32" />}>
          <AnalyticsCrmGrowth {...section} />
        </Suspense>
        <Suspense key={`usage-${period}`} fallback={<AnalyticsCardSkeleton bodyClassName="h-64" />}>
          <AnalyticsUsageTotals {...section} />
        </Suspense>
      </div>
    </div>
  );
}
