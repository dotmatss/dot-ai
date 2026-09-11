import { listAttachableMcpTools } from "@/features/mcp/server/agent-mcp";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string };

/**
 * The tools this workspace has approved, for attaching to an agent.
 *
 * `member`, not `admin`: approving a tool is the privileged decision and it has
 * already been made. Choosing which of the approved tools a particular agent
 * offers is ordinary agent configuration, and it can only ever narrow what is
 * already allowed.
 */
export const GET = workspaceRoute<Params>(
  async ({ membership }) => {
    const tools = await listAttachableMcpTools(membership.workspace.id);
    return ok(tools);
  },
  { minimumRole: "member" },
);
