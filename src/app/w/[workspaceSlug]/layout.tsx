import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceProvider } from "@/features/workspaces/components/workspace-provider";
import { listUserWorkspaces } from "@/features/workspaces/server/workspace-repository";
import { requireWorkspaceAccess } from "@/server/auth/dal";
import { SIDEBAR_COOKIE } from "@/stores/ui-preferences-store";

export default async function WorkspaceLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  const { user, membership } = await requireWorkspaceAccess(workspaceSlug);
  const [workspaces, cookieStore] = await Promise.all([listUserWorkspaces(user.id), cookies()]);
  const sidebarCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <WorkspaceProvider value={{ user, membership, workspaces }}>
      <AppShell initialSidebarCollapsed={sidebarCollapsed}>{children}</AppShell>
    </WorkspaceProvider>
  );
}
