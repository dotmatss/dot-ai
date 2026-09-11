import { ArrowUpRight, BookOpen } from "lucide-react";
import type { Route } from "next";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppButtonLink } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardDescription, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppProgressBar } from "@/components/ui/app-progress";
import { getKnowledgeStatus } from "@/features/dashboard/server/dashboard-service";

export async function DashboardKnowledgeStatus({ workspaceId, workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  const status = await getKnowledgeStatus(workspaceId);
  const href = `/w/${workspaceSlug}/knowledge` as Route;
  return (
    <AppCard>
      <AppCardHeader>
        <div>
          <AppCardTitle>Knowledge bases</AppCardTitle>
          <AppCardDescription>Ingestion and indexing status.</AppCardDescription>
        </div>
        <AppButtonLink href={href} variant="ghost" size="sm" trailingIcon={<ArrowUpRight aria-hidden />}>
          Manage
        </AppButtonLink>
      </AppCardHeader>
      <AppCardContent className="pt-4">
        {status.knowledgeBases === 0 ? (
          <AppEmptyState
            size="sm"
            icon={<BookOpen aria-hidden />}
            title="No knowledge bases"
            description="Add documents or URLs so chatbots can answer from your content."
            action={
              <AppButtonLink href={href} size="sm" variant="secondary">
                Create knowledge base
              </AppButtonLink>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md border border-border bg-surface-muted/50 py-3">
                <dt className="text-caption uppercase tracking-wide text-foreground-muted">Ready</dt>
                <dd className="text-lg font-semibold tabular-nums">{status.ready}</dd>
              </div>
              <div className="rounded-md border border-border bg-surface-muted/50 py-3">
                <dt className="text-caption uppercase tracking-wide text-foreground-muted">Processing</dt>
                <dd className="text-lg font-semibold tabular-nums">{status.processing}</dd>
              </div>
              <div className="rounded-md border border-border bg-surface-muted/50 py-3">
                <dt className="text-caption uppercase tracking-wide text-foreground-muted">Errors</dt>
                <dd className="text-lg font-semibold tabular-nums">{status.error}</dd>
              </div>
            </dl>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs text-foreground-muted">
                <span>Sources indexed</span>
                <span className="tabular-nums">
                  {status.sourcesReady} / {status.sources}
                </span>
              </div>
              <AppProgressBar value={status.sourcesReady} max={Math.max(1, status.sources)} label="Sources indexed" size="sm" />
            </div>
          </div>
        )}
      </AppCardContent>
    </AppCard>
  );
}
