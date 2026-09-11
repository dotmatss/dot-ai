import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { IntegrationsTabs } from "@/features/integrations/components/integrations-tabs";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export default async function IntegrationsLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/integrations">) {
  const { workspaceSlug } = await params;
  // Re-authorized here rather than trusting the parent layout: this subtree
  // shows credential state, so its access check lives with it.
  await requireWorkspaceAccess(workspaceSlug);

  return (
    <PageContainer>
      <PageHeader
        title="Integrations"
        description="Connect the tools your workspace already uses, and issue API keys for your own services."
      >
        <IntegrationsTabs />
      </PageHeader>
      <div>{children}</div>
    </PageContainer>
  );
}
