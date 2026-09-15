"use client";

import { MessagesSquare, Sparkles, TriangleAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppChip } from "@/components/ui/app-chip";
import { AppSearchInput } from "@/components/ui/app-input";
import { AppPagination, paginationSummary } from "@/components/ui/app-pagination";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSelect } from "@/components/ui/app-select";
import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableMessageRow,
  AppTableRow,
} from "@/components/ui/app-table";
import { AppTooltip } from "@/components/ui/app-tooltip";
import { CoverageMeter } from "@/features/intelligence/components/coverage-meter";
import { TOPIC_SORT_LABELS } from "@/features/intelligence/constants";
import { hasActiveTopicFilters, parseTopicFilters, TOPIC_FILTER_KEYS } from "@/features/intelligence/filters";
import { containmentRate, coverageRate, formatRate, isKnowledgeGap } from "@/features/intelligence/metrics";
import { useTopicsQuery } from "@/features/intelligence/queries";
import { TOPIC_SORTS, type TopicSummary } from "@/features/intelligence/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearchParamState } from "@/hooks/use-search-param-state";
import { pageCount } from "@/types/pagination";

const COLUMNS = 5;

function TopicRow({ topic }: { topic: TopicSummary }) {
  const { membership } = useWorkspace();
  const href = `/w/${membership.workspace.slug}/intelligence/${topic.id}` as Route;
  const gap = isKnowledgeGap(topic);

  return (
    <AppTableRow>
      <AppTableCell>
        <Link href={href} className="group block rounded-md focus-ring">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground group-hover:underline group-hover:underline-offset-4">
              {topic.label}
            </span>
            {gap ? (
              <AppTooltip content="Most of these conversations were answered with no supporting document.">
                <span tabIndex={0} className="rounded-full focus-ring" aria-label="Knowledge gap">
                  <AppBadge tone="danger" size="sm">
                    <TriangleAlert className="size-3" aria-hidden />
                    Gap
                  </AppBadge>
                </span>
              </AppTooltip>
            ) : null}
            {topic.labeledAt === null ? (
              <AppTooltip content="Named from its own questions. The next analysis will write a proper label.">
                <span tabIndex={0} className="rounded-full focus-ring" aria-label="Not yet named by the model">
                  <AppBadge variant="outline" size="sm">
                    Unnamed
                  </AppBadge>
                </span>
              </AppTooltip>
            ) : null}
          </span>
          {topic.summary ? (
            <span className="mt-0.5 block max-w-xl truncate text-xs text-foreground-muted">{topic.summary}</span>
          ) : null}
        </Link>
      </AppTableCell>
      <AppTableCell className="tabular-nums text-foreground-secondary">
        {topic.conversationCount.toLocaleString("en")}
      </AppTableCell>
      <AppTableCell className="min-w-40">
        <CoverageMeter value={coverageRate(topic)} />
      </AppTableCell>
      <AppTableCell className="tabular-nums text-foreground-secondary">
        {formatRate(containmentRate(topic))}
      </AppTableCell>
      <AppTableCell className="whitespace-nowrap text-foreground-muted">
        {topic.lastSeenAt ? <AppRelativeTime value={topic.lastSeenAt} /> : <span className="text-foreground-subtle">—</span>}
      </AppTableCell>
    </AppTableRow>
  );
}

export function TopicsList() {
  const [params, setParams] = useSearchParamState(TOPIC_FILTER_KEYS);
  const [search, setSearch] = useState(params.q ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    const current = params.q ?? "";
    if (debouncedSearch !== current) setParams({ q: debouncedSearch || undefined });
  }, [debouncedSearch, params.q, setParams]);

  const filters = useMemo(
    () => parseTopicFilters({ ...params, q: debouncedSearch || undefined }),
    [params, debouncedSearch],
  );
  const query = useTopicsQuery(filters);
  const filtered = hasActiveTopicFilters(filters);

  function clearFilters() {
    setSearch("");
    setParams({ q: undefined, gaps: undefined, sort: undefined });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full lg:max-w-xs">
          <AppSearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search topics…"
            aria-label="Search topics"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AppChip
            selected={Boolean(filters.gapsOnly)}
            onClick={() => setParams({ gaps: filters.gapsOnly ? undefined : "1" })}
          >
            <TriangleAlert className="size-3.5" aria-hidden />
            Knowledge gaps
          </AppChip>
          <AppSelect
            size="sm"
            aria-label="Sort topics"
            value={filters.sort}
            onChange={(event) => setParams({ sort: event.target.value })}
            options={TOPIC_SORTS.map((sort) => ({ value: sort, label: TOPIC_SORT_LABELS[sort] }))}
            className="w-56"
          />
        </div>
      </div>

      {query.isPending ? (
        <AppListSkeleton rows={6} />
      ) : query.isError ? (
        <AppTableContainer>
          <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />
        </AppTableContainer>
      ) : (
        <>
          <AppTableContainer aria-busy={query.isFetching || undefined}>
            <AppTable>
              <AppTableHeader>
                <AppTableRow>
                  <AppTableHead>Topic</AppTableHead>
                  <AppTableHead>Conversations</AppTableHead>
                  <AppTableHead>Answered from knowledge</AppTableHead>
                  <AppTableHead>Contained</AppTableHead>
                  <AppTableHead>Last seen</AppTableHead>
                </AppTableRow>
              </AppTableHeader>
              <AppTableBody>
                {query.data.items.length === 0 ? (
                  <AppTableMessageRow colSpan={COLUMNS}>
                    {filtered ? (
                      <AppEmptyState
                        size="sm"
                        title="No topics match your filters"
                        description="Try a different search term, or turn off the knowledge-gap filter."
                        action={
                          <AppButton variant="secondary" size="sm" onClick={clearFilters}>
                            Clear filters
                          </AppButton>
                        }
                      />
                    ) : (
                      <AppEmptyState
                        icon={<MessagesSquare aria-hidden />}
                        title="Nothing analyzed yet"
                        description="Run an analysis to group your conversations into topics and see which ones your knowledge base cannot answer."
                        action={
                          <span className="flex items-center gap-2 text-xs text-foreground-muted">
                            <Sparkles className="size-3.5" aria-hidden />
                            Use “Analyze conversations” above.
                          </span>
                        }
                      />
                    )}
                  </AppTableMessageRow>
                ) : (
                  query.data.items.map((topic) => <TopicRow key={topic.id} topic={topic} />)
                )}
              </AppTableBody>
            </AppTable>
          </AppTableContainer>
          <AppPagination
            page={query.data.page}
            pageCount={pageCount(query.data.total, query.data.pageSize)}
            onPageChange={(page) => setParams({ page: page > 1 ? page : undefined }, { resetPage: false })}
            summary={paginationSummary(query.data.page, query.data.pageSize, query.data.total)}
          />
        </>
      )}
    </div>
  );
}
