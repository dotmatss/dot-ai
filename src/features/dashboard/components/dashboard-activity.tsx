import { Activity, Bot, BookOpen, Cpu, Plug, Users, Workflow } from "lucide-react";
import type { ReactNode } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppCard, AppCardContent, AppCardDescription, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
// The activity log belongs to the audit feature, which owns the table and its
// read models; this card is one of its two consumers.
import { listRecentActivity } from "@/features/audit/server/audit-service";
import { formatRelativeTime } from "@/lib/format/date";

const ICONS: Record<string, ReactNode> = {
  chatbot: <Bot aria-hidden />,
  agent: <Cpu aria-hidden />,
  workflow: <Workflow aria-hidden />,
  knowledge_collection: <BookOpen aria-hidden />,
  // Written before migration 0016 renamed the concept; those rows are history.
  knowledge_base: <BookOpen aria-hidden />,
  knowledge_source: <BookOpen aria-hidden />,
  contact: <Users aria-hidden />,
  integration: <Plug aria-hidden />,
};

export async function DashboardActivity({ workspaceId }: { workspaceId: string }) {
  const entries = await listRecentActivity(workspaceId, 8);
  return (
    <AppCard className="flex flex-col">
      <AppCardHeader>
        <div>
          <AppCardTitle>Recent activity</AppCardTitle>
          <AppCardDescription>Changes made by your team across the workspace.</AppCardDescription>
        </div>
      </AppCardHeader>
      <AppCardContent className="pt-4">
        {entries.length === 0 ? (
          <AppEmptyState size="sm" icon={<Activity aria-hidden />} title="No activity yet" description="Create a chatbot or a knowledge collection to see activity here." />
        ) : (
          <ol className="flex flex-col">
            {entries.map((entry) => (
              <li key={entry.id} className="flex gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-muted [&_svg]:size-3.5">
                  {ICONS[entry.entityType] ?? <Activity aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{entry.summary}</p>
                  <p className="text-xs text-foreground-muted">
                    {entry.actorName ?? "System"} · {formatRelativeTime(entry.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </AppCardContent>
    </AppCard>
  );
}
