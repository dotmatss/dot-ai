import { AppBarChart } from "@/components/charts/app-bar-chart";
import { AppCard, AppCardContent, AppCardDescription, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { getUsageSummary } from "@/features/dashboard/server/dashboard-service";
import { formatCompactNumber } from "@/lib/format/number";

function shortDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

export async function DashboardUsage({ workspaceId }: { workspaceId: string }) {
  const usage = await getUsageSummary(workspaceId, 14);
  const data = usage.dailyMessages.map((d) => ({ label: shortDay(d.date), value: d.count }));
  return (
    <AppCard>
      <AppCardHeader>
        <div>
          <AppCardTitle>Usage</AppCardTitle>
          <AppCardDescription>Visitor messages per day over the last 14 days.</AppCardDescription>
        </div>
        <dl className="flex gap-6 text-right text-xs">
          <div>
            <dt className="text-foreground-muted">Tokens in · 30d</dt>
            <dd className="text-sm font-semibold tabular-nums">{formatCompactNumber(usage.tokensInLast30Days)}</dd>
          </div>
          <div>
            <dt className="text-foreground-muted">Tokens out · 30d</dt>
            <dd className="text-sm font-semibold tabular-nums">{formatCompactNumber(usage.tokensOutLast30Days)}</dd>
          </div>
        </dl>
      </AppCardHeader>
      <AppCardContent>
        <AppBarChart data={data} title="Visitor messages per day, last 14 days" valueLabel="Messages" height={220} />
      </AppCardContent>
    </AppCard>
  );
}
