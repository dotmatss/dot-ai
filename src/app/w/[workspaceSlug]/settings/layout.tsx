import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsTabs } from "@/features/settings/components/settings-tabs";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export default async function SettingsLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/settings">) {
  const { workspaceSlug } = await params;
  // Re-authorized here rather than trusting the parent layout: this subtree
  // shows membership and session state, so its access check lives with it.
  await requireWorkspaceAccess(workspaceSlug);

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Your workspace, the people in it, and the account you are signed in with."
      >
        <SettingsTabs />
      </PageHeader>
      <div>{children}</div>
    </PageContainer>
  );
}
