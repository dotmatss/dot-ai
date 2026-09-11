import { AppSparkline } from "@/components/charts/app-sparkline";
import { AppStat } from "@/components/ui/app-stat";
import { getDashboardStats, getUsageSummary } from "@/features/dashboard/server/dashboard-service";
import { formatCompactNumber } from "@/lib/format/number";

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export async function DashboardStats({ workspaceId }: { workspaceId: string }) {
  const [stats, usage] = await Promise.all([getDashboardStats(workspaceId), getUsageSummary(workspaceId, 14)]);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <AppStat
        label="Conversations · 7 days"
        value={formatCompactNumber(stats.conversationsLast7Days)}
        delta={percentChange(stats.conversationsLast7Days, stats.conversationsPrevious7Days)}
        deltaLabel="vs previous 7 days"
      />
      <AppStat
        label="Messages · 7 days"
        value={formatCompactNumber(stats.messagesLast7Days)}
        delta={percentChange(stats.messagesLast7Days, stats.messagesPrevious7Days)}
        deltaLabel="vs previous 7 days"
        visual={<AppSparkline values={usage.dailyMessages.map((d) => d.count)} label="Visitor messages per day, last 14 days" />}
      />
      <AppStat
        label="Active chatbots"
        value={stats.activeChatbots}
        hint={<span className="text-xs text-foreground-muted">of {stats.totalChatbots}</span>}
      />
      <AppStat
        label="Contacts"
        value={formatCompactNumber(stats.contacts)}
        hint={<span className="text-xs text-foreground-muted">+{stats.newContactsLast7Days} this week</span>}
      />
    </div>
  );
}
