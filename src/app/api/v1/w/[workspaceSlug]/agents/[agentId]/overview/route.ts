import { getAgentOverviewStats } from "@/features/agents/server/agent-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; agentId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  const overview = await getAgentOverviewStats(membership.workspace.id, params.agentId);
  return ok(overview);
});
