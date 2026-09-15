"use client";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { PageContainer } from "@/components/layout/page-container";
import { TopicConversations } from "@/features/intelligence/components/topic-conversations";
import { TopicHeader } from "@/features/intelligence/components/topic-header";
import { TopicOverview } from "@/features/intelligence/components/topic-overview";
import { useTopicQuery } from "@/features/intelligence/queries";
import { useSearchParamState } from "@/hooks/use-search-param-state";

const PAGE_KEYS = ["page"] as const;

/**
 * The whole topic screen.
 *
 * One client component rather than a tab shell: a topic is a single view, and
 * splitting the summary from its conversations would put the counts on one tab
 * and the rows they count on another. Pagination lives in the URL so a
 * particular page of a topic stays a link somebody can send.
 */
export function TopicDetail({ topicId }: { topicId: string }) {
  const [params, setParams] = useSearchParamState(PAGE_KEYS);
  const pageParam = Number(params.page ?? 1);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  const query = useTopicQuery(topicId);

  if (query.isPending) {
    return (
      <PageContainer>
        <AppListSkeleton rows={6} />
      </PageContainer>
    );
  }

  if (query.isError) {
    return (
      <PageContainer>
        <AppErrorState error={query.error} onRetry={() => void query.refetch()} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <TopicHeader topic={query.data} />
      <div className="flex flex-col gap-6">
        <TopicOverview topic={query.data} />
        <TopicConversations
          topicId={topicId}
          page={page}
          onPageChange={(next) => setParams({ page: next > 1 ? next : undefined }, { resetPage: false })}
        />
      </div>
    </PageContainer>
  );
}
