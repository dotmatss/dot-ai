import { getAgent, getAgentKnowledgeOptions } from "@/features/agents/server/agent-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; agentId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  // Resolving the agent first keeps a missing agent a 404 rather than an empty list.
  await getAgent(membership.workspace.id, params.agentId);
  const options = await getAgentKnowledgeOptions(membership.workspace.id, params.agentId);
  return ok(options);
});
