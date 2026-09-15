import { getAgent, getAgentDelegationCandidates } from "@/features/agents/server/agent-service";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; agentId: string };

/**
 * The agents this supervisor could delegate to, with their current grant.
 *
 * A read, so the floor is membership - the same as every other agent read. The
 * grants themselves are written through `PATCH /agents/{agentId}`, which is
 * where the `member` floor and the ownership checks already live.
 */
export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  // Resolving the agent first keeps a missing agent a 404 rather than an empty list.
  await getAgent(membership.workspace.id, params.agentId);
  const candidates = await getAgentDelegationCandidates(membership.workspace.id, params.agentId);
  return ok(candidates);
});
