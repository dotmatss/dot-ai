import type { Route } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { AppBadge } from "@/components/ui/app-badge";
import { AppCard } from "@/components/ui/app-card";
import { AppStat } from "@/components/ui/app-stat";
import { AppHeading } from "@/components/ui/app-typography";
import { HEALTH_META, ORGANIZATION_STATUS_META } from "@/features/platform/constants";
import { getPlatformOverview } from "@/features/platform/server/platform-overview";
import { formatNumber } from "@/lib/format/number";
import { requirePlatformAccess } from "@/server/auth/platform-dal";

/**
 * Platform overview.
 *
 * Re-authorizes rather than trusting the layout: a layout does not re-run on
 * every navigation, and this page reads across every tenant.
 */
export default async function AdminOverviewPage() {
  await requirePlatformAccess();
  const overview = await getPlatformOverview();

  const tenantHint =
    overview.organizations.suspended + overview.organizations.disabled > 0 ? (
      <AppBadge tone="warning" size="sm">
        {overview.organizations.suspended + overview.organizations.disabled} not active
      </AppBadge>
    ) : undefined;

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="Tenants, accounts and metered activity across the whole platform."
      />

      <section aria-labelledby="tenants-heading" className="flex flex-col gap-3">
        <AppHeading id="tenants-heading" level={2} className="text-base">
          Tenants and accounts
        </AppHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AppStat
            label="Organizations"
            value={formatNumber(overview.organizations.total)}
            hint={tenantHint}
          />
          <AppStat label="Workspaces" value={formatNumber(overview.workspaces.total)} />
          <AppStat
            label="Users"
            value={formatNumber(overview.users.total)}
            hint={
              overview.users.disabled > 0 ? (
                <AppBadge tone="neutral" size="sm">
                  {overview.users.disabled} disabled
                </AppBadge>
              ) : undefined
            }
          />
          <AppStat label="New users (30d)" value={formatNumber(overview.users.newLast30Days)} />
        </div>
      </section>

      <section aria-labelledby="built-heading" className="flex flex-col gap-3">
        <AppHeading id="built-heading" level={2} className="text-base">
          What customers have built
        </AppHeading>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AppStat label="Chatbots" value={formatNumber(overview.build.chatbots)} />
          <AppStat label="Agents" value={formatNumber(overview.build.agents)} />
          <AppStat label="Workflows" value={formatNumber(overview.build.workflows)} />
          <AppStat label="Knowledge collections" value={formatNumber(overview.build.collections)} />
        </div>
      </section>

      <section aria-labelledby="activity-heading" className="flex flex-col gap-3">
        <AppHeading id="activity-heading" level={2} className="text-base">
          Metered activity, last 30 days
        </AppHeading>
        {/*
          Stated plainly rather than dressed up as a ledger. These come from
          `usage_events`, which this application writes on its own request path:
          they record what this system metered, not what a provider invoiced.
        */}
        <p className="text-sm text-foreground-muted">
          Summed from usage events recorded by this application. Not reconciled against any provider&rsquo;s billing.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AppStat label="Conversations" value={formatNumber(overview.activity.conversationsLast30Days)} />
          <AppStat label="Messages" value={formatNumber(overview.activity.messagesLast30Days)} />
          <AppStat label="Workflow runs" value={formatNumber(overview.activity.workflowRunsLast30Days)} />
          <AppStat
            label="Tokens"
            value={formatNumber(overview.activity.tokensInLast30Days + overview.activity.tokensOutLast30Days)}
            hint={
              <span className="text-xs text-foreground-muted">
                {formatNumber(overview.activity.tokensInLast30Days)} in / {formatNumber(overview.activity.tokensOutLast30Days)} out
              </span>
            }
          />
        </div>
      </section>

      <section aria-labelledby="health-heading" className="flex flex-col gap-3">
        <AppHeading id="health-heading" level={2} className="text-base">
          System health
        </AppHeading>
        <AppCard padding="md">
          <dl className="flex flex-col divide-y divide-border">
            {(
              [
                ["Database", overview.health.database],
                ["AI gateway", overview.health.aiGateway],
                ["Embeddings", overview.health.embeddings],
              ] as const
            ).map(([label, check]) => (
              <div key={label} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                <dt className="text-sm font-medium">{label}</dt>
                <dd className="flex items-center gap-3">
                  <span className="text-sm text-foreground-muted">{check.detail}</span>
                  <AppBadge tone={HEALTH_META[check.status].tone} size="sm">
                    {HEALTH_META[check.status].label}
                  </AppBadge>
                </dd>
              </div>
            ))}
          </dl>
        </AppCard>
        {/*
          "Not monitored" is a real answer, and it is why nothing here is drawn
          green by default. A dashboard that invents a healthy tick for a
          component it never probed is worse than having no dashboard.
        */}
        <p className="text-sm text-foreground-muted">
          Only the database is probed live. Components marked{" "}
          <span className="font-medium">{HEALTH_META.unknown.label}</span> report their configuration, not their
          liveness.
        </p>
      </section>

      <section aria-labelledby="jump-heading" className="flex flex-col gap-3">
        <AppHeading id="jump-heading" level={2} className="text-base">
          Manage
        </AppHeading>
        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              ["Organizations", "/admin/organizations", `${overview.organizations.active} active`],
              ["Users", "/admin/users", `${overview.users.total} total`],
              ["Audit logs", "/admin/audit", "Privileged actions"],
            ] as const
          ).map(([label, href, hint]) => (
            <Link
              key={label}
              href={href as Route}
              className="rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <div className="text-sm font-medium">{label}</div>
              <div className="mt-1 text-sm text-foreground-muted">{hint}</div>
            </Link>
          ))}
        </div>
      </section>

      <p className="text-sm text-foreground-muted">
        Suspended tenants keep every row they own. {ORGANIZATION_STATUS_META.suspended.description}
      </p>
    </>
  );
}
