import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { AnalyticsPeriodSwitcher } from "@/features/analytics/components/analytics-period-switcher";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export default async function AnalyticsLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/analytics">) {
  const { workspaceSlug } = await params;
  // Re-authorized here rather than trusting the parent layout: every figure in
  // this subtree is workspace data, so its access check lives with it.
  await requireWorkspaceAccess(workspaceSlug);

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Analytics"
        description="How this workspace is being used: conversations, channels, tokens, workflow outcomes and contact growth."
        actions={<AnalyticsPeriodSwitcher />}
      />
      {children}
    </PageContainer>
  );
}
