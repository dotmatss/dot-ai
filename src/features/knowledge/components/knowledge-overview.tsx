"use client";

import { FolderOpen, Inbox, Layers, Plus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppListSkeleton } from "@/components/feedback/app-loading";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButtonLink } from "@/components/ui/app-button";
import { AppList, AppListItem } from "@/components/ui/app-list-item";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { CollectionStatusBadge } from "@/features/knowledge/components/knowledge-status-badge";
import { collectionHref } from "@/features/knowledge/components/collections-list";
import { CreateCollectionButton } from "@/features/knowledge/components/create-collection-dialog";
import { SourceTypeIcon } from "@/features/knowledge/components/source-type-icon";
import { useKnowledgeOverviewQuery } from "@/features/knowledge/queries";
import type { CollectionSummary, KnowledgeSource } from "@/features/knowledge/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { formatNumber } from "@/lib/format/number";

function plural(count: number, noun: string): string {
  return `${formatNumber(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function CollectionItem({ collection, workspaceSlug }: { collection: CollectionSummary; workspaceSlug: string }) {
  return (
    <AppListItem
      href={collectionHref(workspaceSlug, collection.id)}
      icon={<FolderOpen aria-hidden />}
      title={collection.name}
      description={collection.description ?? `${plural(collection.chunkCount, "passage")} indexed`}
      trailing={
        <span className="flex shrink-0 items-center gap-3">
          <CollectionStatusBadge status={collection.status} size="sm" />
          <span className="whitespace-nowrap text-xs tabular-nums text-foreground-muted">
            {plural(collection.sourceCount, "source")}
          </span>
        </span>
      }
    />
  );
}

function RecentSourceItem({ source, workspaceSlug }: { source: KnowledgeSource; workspaceSlug: string }) {
  return (
    <AppListItem
      leading={<SourceTypeIcon type={source.type} />}
      title={source.name}
      description={<AppRelativeTime value={source.createdAt} />}
      trailing={
        source.collectionId && source.collectionName ? (
          <Link
            href={collectionHref(workspaceSlug, source.collectionId)}
            className="shrink-0 truncate text-xs text-foreground-secondary underline-offset-4 hover:text-foreground hover:underline focus-ring rounded-xs"
          >
            {source.collectionName}
          </Link>
        ) : (
          <AppBadge tone="neutral" size="sm" title="Not in a collection, so no agent can retrieve from it.">
            Unorganized
          </AppBadge>
        )
      }
    />
  );
}

/**
 * The Knowledge landing page: collections first, because organising is the
 * point, then what has been added recently across all of them, and the
 * Unorganized queue when it is not empty.
 */
export function KnowledgeOverview() {
  const { membership } = useWorkspace();
  const slug = membership.workspace.slug;
  const query = useKnowledgeOverviewQuery();

  const allSourcesHref = `/w/${slug}/knowledge/sources` as Route;
  const unorganizedHref = `/w/${slug}/knowledge/sources?scope=unorganized` as Route;
  const allCollectionsHref = `/w/${slug}/knowledge/collections` as Route;

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-8" aria-busy="true">
        <AppSkeleton className="h-16 w-full" />
        <AppListSkeleton rows={4} />
        <AppListSkeleton rows={3} />
      </div>
    );
  }
  if (query.isError) {
    return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const { collections, collectionTotal, recentSources, unorganizedCount, totalSourceCount } = query.data;

  if (totalSourceCount === 0 && collectionTotal === 0) {
    return (
      <AppEmptyState
        icon={<Layers aria-hidden />}
        title="Nothing in knowledge yet"
        description="Collections group the text, pages and files your chatbots and agents answer from. Attaching a collection to an agent is how you decide what it can and cannot see."
        action={<CreateCollectionButton />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-3 sm:grid-cols-2">
        <AppListItem
          href={allSourcesHref}
          icon={<Layers aria-hidden />}
          title="All knowledge"
          description={`${plural(totalSourceCount, "source")} across every collection`}
          className="rounded-lg border border-border bg-surface shadow-xs"
        />
        <AppListItem
          href={unorganizedHref}
          icon={<Inbox aria-hidden />}
          title="Unorganized"
          description={
            unorganizedCount === 0
              ? "Everything has been filed"
              : `${plural(unorganizedCount, "source")} no agent can retrieve yet`
          }
          trailing={
            unorganizedCount > 0 ? (
              <AppBadge tone="warning" size="sm">
                {formatNumber(unorganizedCount)}
              </AppBadge>
            ) : undefined
          }
          className="rounded-lg border border-border bg-surface shadow-xs"
        />
      </div>

      <Section
        title="Collections"
        action={
          collectionTotal > collections.length ? (
            <AppButtonLink variant="ghost" size="sm" href={allCollectionsHref}>
              View all {formatNumber(collectionTotal)}
            </AppButtonLink>
          ) : (
            <CreateCollectionButton size="sm" />
          )
        }
      >
        {collections.length === 0 ? (
          <AppEmptyState
            size="sm"
            icon={<FolderOpen aria-hidden />}
            title="No collections yet"
            description="Group your sources so an agent can be given exactly the knowledge it should answer from."
            action={<CreateCollectionButton size="sm" />}
          />
        ) : (
          <AppList>
            {collections.map((collection) => (
              <CollectionItem key={collection.id} collection={collection} workspaceSlug={slug} />
            ))}
          </AppList>
        )}
      </Section>

      <Section
        title="Recent sources"
        action={
          <AppButtonLink variant="ghost" size="sm" href={allSourcesHref}>
            View all
          </AppButtonLink>
        }
      >
        {recentSources.length === 0 ? (
          <AppEmptyState
            size="sm"
            icon={<Plus aria-hidden />}
            title="No sources yet"
            description="Open a collection to paste text, import a page or upload a file."
          />
        ) : (
          <AppList>
            {recentSources.map((source) => (
              <RecentSourceItem key={source.id} source={source} workspaceSlug={slug} />
            ))}
          </AppList>
        )}
      </Section>
    </div>
  );
}
