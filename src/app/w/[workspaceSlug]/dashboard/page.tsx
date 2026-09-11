import type { Metadata } from "next";
import { Suspense } from "react";

import { AppStatGridSkeleton } from "@/components/feedback/app-loading";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { DashboardActivity } from "@/features/dashboard/components/dashboard-activity";
import { DashboardChatbotPerformance } from "@/features/dashboard/components/dashboard-chatbot-performance";
import { DashboardCrmActivity } from "@/features/dashboard/components/dashboard-crm-activity";
import { DashboardKnowledgeStatus } from "@/features/dashboard/components/dashboard-knowledge-status";
import { DashboardStats } from "@/features/dashboard/components/dashboard-stats";
import { DashboardUsage } from "@/features/dashboard/components/dashboard-usage";
import { DashboardWorkflowActivity } from "@/features/dashboard/components/dashboard-workflow-activity";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Each section is an independent async Server Component behind its own
 * Suspense boundary, so slow aggregates never block the rest of the page.
 */
export default async function DashboardPage({ params }: PageProps<"/w/[workspaceSlug]/dashboard">) {
  const { workspaceSlug } = await params;
  const { user, membership } = await requireWorkspaceAccess(workspaceSlug);
  const workspaceId = membership.workspace.id;

  return (
    <PageContainer width="wide">
      <PageHeader
        title={`${greeting()}, ${user.name.split(" ")[0]}`}
        description={`Here is what is happening in ${membership.workspace.name}.`}
      />

      <Suspense fallback={<AppStatGridSkeleton />}>
        <DashboardStats workspaceId={workspaceId} />
      </Suspense>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <Suspense fallback={<AppSkeleton className="h-80" />}>
            <DashboardUsage workspaceId={workspaceId} />
          </Suspense>
          <div className="grid gap-6 lg:grid-cols-2">
            <Suspense fallback={<AppSkeleton className="h-72" />}>
              <DashboardChatbotPerformance workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
            </Suspense>
            <Suspense fallback={<AppSkeleton className="h-72" />}>
              <DashboardWorkflowActivity workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
            </Suspense>
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <Suspense fallback={<AppSkeleton className="h-64" />}>
            <DashboardActivity workspaceId={workspaceId} />
          </Suspense>
          <Suspense fallback={<AppSkeleton className="h-56" />}>
            <DashboardKnowledgeStatus workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
          </Suspense>
          <Suspense fallback={<AppSkeleton className="h-56" />}>
            <DashboardCrmActivity workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  );
}
