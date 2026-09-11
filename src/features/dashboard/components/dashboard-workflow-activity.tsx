import { ArrowUpRight, Workflow } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppBadge, type BadgeTone } from "@/components/ui/app-badge";
import { AppButtonLink } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardDescription, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { getWorkflowActivity } from "@/features/dashboard/server/dashboard-service";
import { formatRelativeTime } from "@/lib/format/date";

const RUN_TONE: Record<string, BadgeTone> = {
  succeeded: "success",
  failed: "danger",
  running: "info",
  queued: "neutral",
  cancelled: "neutral",
  waiting_approval: "warning",
};

export async function DashboardWorkflowActivity({ workspaceId, workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  const activity = await getWorkflowActivity(workspaceId);
  const base = `/w/${workspaceSlug}/workflows`;
  return (
    <AppCard>
      <AppCardHeader>
        <div>
          <AppCardTitle>Workflow activity</AppCardTitle>
          <AppCardDescription>
            {activity.activeWorkflows} active · {activity.runsLast7Days} runs this week · {activity.failedLast7Days} failed
          </AppCardDescription>
        </div>
        <AppButtonLink href={base as Route} variant="ghost" size="sm" trailingIcon={<ArrowUpRight aria-hidden />}>
          Workflows
        </AppButtonLink>
      </AppCardHeader>
      <AppCardContent className="pt-4">
        {activity.recentRuns.length === 0 ? (
          <AppEmptyState
            size="sm"
            icon={<Workflow aria-hidden />}
            title="No workflow runs yet"
            description="Build a workflow to automate follow-ups, routing and integrations."
            action={
              <AppButtonLink href={base as Route} size="sm" variant="secondary">
                Open workflows
              </AppButtonLink>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {activity.recentRuns.map((run) => (
              <li key={run.id}>
                <Link
                  href={`${base}/${run.workflowId}` as Route}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 text-sm hover:bg-surface-hover focus-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{run.workflowName}</span>
                    <span className="block text-xs text-foreground-muted">
                      {run.finishedAt ? `Finished ${formatRelativeTime(run.finishedAt)}` : run.startedAt ? `Started ${formatRelativeTime(run.startedAt)}` : "Queued"}
                    </span>
                  </span>
                  <AppBadge tone={RUN_TONE[run.status] ?? "neutral"} size="sm" dot>
                    {run.status.replace("_", " ")}
                  </AppBadge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AppCardContent>
    </AppCard>
  );
}
