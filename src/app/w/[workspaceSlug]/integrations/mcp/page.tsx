import type { Metadata } from "next";
import type { Route } from "next";

import { AppButtonLink } from "@/components/ui/app-button";

import { AppHeading, AppText } from "@/components/ui/app-typography";
import { ConnectMcpServerButton } from "@/features/mcp/components/connect-mcp-server-dialog";
import { McpServersPanel } from "@/features/mcp/components/mcp-servers-panel";
import { mcpKeys } from "@/features/mcp/queries";
import { listMcpServers } from "@/features/mcp/server/mcp-service";
import { canManage } from "@/features/workspaces/roles";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "MCP servers" };

/**
 * Connected MCP servers.
 *
 * The list is seeded on the server and hydrated, like every other list in the
 * application. Credentials are not part of the payload: the service returns
 * only whether one is configured.
 */
export default async function McpServersPage({ params }: PageProps<"/w/[workspaceSlug]/integrations/mcp">) {
  const { workspaceSlug } = await params;
  const { membership, user } = await requireWorkspaceAccess(workspaceSlug);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    mcpKeys.servers(workspaceSlug),
    await listMcpServers({ workspaceId: membership.workspace.id, userId: user.id }),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <AppHeading level={2} className="text-lg">
            MCP servers
          </AppHeading>
          <AppText size="sm" tone="muted">
            Connect a remote Model Context Protocol server so your agents can use the tools it provides. Every tool is
            approved by hand, and an approval is pinned to the tool as it was written when you approved it.
          </AppText>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* The approvals page is admin-floored, so offering the link to a
              member or viewer would send them at a 403 they cannot act on. */}
          {canManage(membership.role) ? (
            <AppButtonLink href={`/w/${workspaceSlug}/integrations/mcp/approvals` as Route} variant="secondary">
              Tool approvals
            </AppButtonLink>
          ) : null}
          <ConnectMcpServerButton />
        </div>
      </div>
      <HydrateClient queryClient={queryClient}>
        <McpServersPanel />
      </HydrateClient>
    </div>
  );
}
