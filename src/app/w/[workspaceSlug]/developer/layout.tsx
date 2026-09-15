import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { DeveloperTabs } from "@/features/developer/components/developer-tabs";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export default async function DeveloperLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/developer">) {
  const { workspaceSlug } = await params;
  // Re-authorized here rather than trusting the parent layout: this subtree
  // issues credentials, so its access check lives with it.
  await requireWorkspaceAccess(workspaceSlug);

  return (
    <PageContainer>
      <PageHeader
        title="Developer"
        description="Ways your own systems and your website reach this workspace. To connect this workspace to someone else's tools, use Integrations."
      >
        <DeveloperTabs />
      </PageHeader>
      <div>{children}</div>
    </PageContainer>
  );
}
