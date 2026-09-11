import type { Metadata } from "next";

import { AppHeading, AppText } from "@/components/ui/app-typography";
import { McpApprovalsQueue } from "@/features/mcp/components/mcp-approvals-queue";
import { mcpKeys } from "@/features/mcp/queries";
import { listMcpApprovals } from "@/features/mcp/server/mcp-approvals";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Tool approvals" };

/**
 * The queue of tool calls waiting for a person.
 *
 * `admin`, the same role that approves a tool in the first place: the queue
 * shows the arguments a model proposed, which is customer data, and deciding a
 * call runs it.
 */
export default async function McpApprovalsPage({ params }: PageProps<"/w/[workspaceSlug]/integrations/mcp/approvals">) {
  const { workspaceSlug } = await params;
  const { membership, user } = await requireWorkspaceAccess(workspaceSlug, "admin");

  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    mcpKeys.approvals(workspaceSlug),
    await listMcpApprovals({ workspaceId: membership.workspace.id, userId: user.id }),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <AppHeading level={2} className="text-lg">
          Tool approvals
        </AppHeading>
        <AppText size="sm" tone="muted">
          An agent asked to use a tool that needs a person first. Nothing has run. Approving authorises that one call, and
          the tool, its approval and the agent&apos;s own configuration are all re-checked before it does.
        </AppText>
      </div>
      <HydrateClient queryClient={queryClient}>
        <McpApprovalsQueue />
      </HydrateClient>
    </div>
  );
}
