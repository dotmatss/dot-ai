"use client";

import Link from "next/link";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppText } from "@/components/ui/app-typography";
import { EntitlementTable } from "@/features/billing/components/entitlement-table";
import { PlanAssignmentForm } from "@/features/billing/components/plan-assignment-form";
import { PlanSummary } from "@/features/billing/components/plan-summary";
import { useBillingOverviewQuery } from "@/features/billing/queries";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

/**
 * The Billing tab.
 *
 * Deliberately does NOT restate the metered totals the Usage tab already
 * renders - it links there instead. This page answers "what is this workspace
 * allowed"; Usage answers "what did it consume", and `USAGE_KIND_META` stays
 * owned by the analytics feature either way.
 */
export function BillingPanel() {
  const { membership } = useWorkspace();
  const query = useBillingOverviewQuery();

  if (query.isPending) return <AppSkeleton className="h-96 rounded-lg" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const overview = query.data;

  return (
    <div className="flex flex-col gap-8">
      <PlanSummary overview={overview} />
      <EntitlementTable entitlements={overview.entitlements} />
      <AppText size="sm" tone="muted">
        For a full breakdown of what this workspace metered, see{" "}
        <Link href={`/w/${membership.workspace.slug}/settings/usage`} className="underline underline-offset-4">
          Usage
        </Link>
        .
      </AppText>
      <PlanAssignmentForm overview={overview} />
    </div>
  );
}
