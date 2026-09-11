import { ArrowUpRight, Bot } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppBadge, type BadgeTone } from "@/components/ui/app-badge";
import { AppButtonLink } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardDescription, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { getChatbotPerformance } from "@/features/dashboard/server/dashboard-service";

const STATUS_TONE: Record<string, BadgeTone> = { active: "success", paused: "warning", draft: "neutral", archived: "neutral" };

export async function DashboardChatbotPerformance({ workspaceId, workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  const rows = await getChatbotPerformance(workspaceId, 5);
  const base = `/w/${workspaceSlug}/chatbots`;
  const max = Math.max(1, ...rows.map((r) => r.conversationsLast7Days));
  return (
    <AppCard>
      <AppCardHeader>
        <div>
          <AppCardTitle>Chatbot performance</AppCardTitle>
          <AppCardDescription>Conversations in the last 7 days.</AppCardDescription>
        </div>
        <AppButtonLink href={base as Route} variant="ghost" size="sm" trailingIcon={<ArrowUpRight aria-hidden />}>
          All chatbots
        </AppButtonLink>
      </AppCardHeader>
      <AppCardContent className="pt-4">
        {rows.length === 0 ? (
          <AppEmptyState
            size="sm"
            icon={<Bot aria-hidden />}
            title="No chatbots yet"
            description="Create a chatbot to start tracking conversations."
            action={
              <AppButtonLink href={base as Route} size="sm">
                Create chatbot
              </AppButtonLink>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`${base}/${row.id}` as Route} className="group flex flex-col gap-1.5 rounded-md focus-ring">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium group-hover:underline group-hover:underline-offset-4">{row.name}</span>
                      <AppBadge tone={STATUS_TONE[row.status] ?? "neutral"} size="sm">
                        {row.status}
                      </AppBadge>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-foreground-muted">
                      {row.conversationsLast7Days} conv · {row.messagesLast7Days} msgs
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-border" aria-hidden>
                    <div className="h-full rounded-full bg-foreground" style={{ width: `${(row.conversationsLast7Days / max) * 100}%` }} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AppCardContent>
    </AppCard>
  );
}
