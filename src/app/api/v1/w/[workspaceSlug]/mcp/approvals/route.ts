import { listMcpApprovals } from "@/features/mcp/server/mcp-approvals";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string };

/**
 * The tool calls waiting for a person.
 *
 * `admin`, the same role that approves a tool in the first place. The queue
 * carries the arguments a model proposed, which is customer data and is not
 * something every member needs to see.
 */
export const GET = workspaceRoute<Params>(
  async ({ membership, user }) => {
    const calls = await listMcpApprovals({ workspaceId: membership.workspace.id, userId: user.id });
    return ok(calls);
  },
  { minimumRole: "admin" },
);
