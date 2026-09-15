import type { Metadata } from "next";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { AnalysisHistory } from "@/features/intelligence/components/analysis-history";
import { IntelligenceStats } from "@/features/intelligence/components/intelligence-stats";
import { RunAnalysisButton } from "@/features/intelligence/components/run-analysis-button";
import { TopicsList } from "@/features/intelligence/components/topics-list";
import { parseTopicFilters } from "@/features/intelligence/filters";
import { intelligenceKeys } from "@/features/intelligence/queries";
import { getDashboard, getTopics } from "@/features/intelligence/server/intelligence-service";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Intelligence" };

/**
 * What people asked, and what the assistant could not answer.
 *
 * `getDashboard` reads the overview, the topics and the run history together so
 * the totals and the rows underneath them describe the same instant. All three
 * are then seeded into the query cache and rendered by Client Components.
 *
 * WHY EVERYTHING ON THIS PAGE IS A CLIENT COMPONENT
 * -------------------------------------------------
 * One action changes every number here at once: finishing an analysis. The
 * mutation invalidates this feature's whole key subtree, and anything rendered
 * on the server would sit out that invalidation - leaving the previous run's
 * containment rate above the new run's topic list until the route happened to
 * be refreshed. Seeding the cache keeps the first paint free of requests, so
 * this costs nothing and stays consistent.
 */
export default async function IntelligencePage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/intelligence">) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);
  const filters = parseTopicFilters(query);

  const [dashboard, topics] = await Promise.all([
    getDashboard(membership.workspace.id, filters),
    getTopics(membership.workspace.id, filters),
  ]);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(intelligenceKeys.list(workspaceSlug, filters), topics);
  queryClient.setQueryData(intelligenceKeys.overview(workspaceSlug), dashboard.overview);
  queryClient.setQueryData(intelligenceKeys.runs(workspaceSlug), dashboard.runs);

  return (
    <HydrateClient queryClient={queryClient}>
      <PageContainer>
        <PageHeader
          title="Intelligence"
          description="What people are asking your assistants, how often they got an answer, and what your knowledge base is missing."
          actions={<RunAnalysisButton latestRun={dashboard.runs[0] ?? null} />}
        />
        <IntelligenceStats overview={dashboard.overview} />
        <TopicsList />
        <AnalysisHistory />
      </PageContainer>
    </HydrateClient>
  );
}
