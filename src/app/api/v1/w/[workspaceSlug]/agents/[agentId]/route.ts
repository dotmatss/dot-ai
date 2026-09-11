import { updateAgentSchema } from "@/features/agents/schemas";
import { deleteAgent, getAgent, updateAgent } from "@/features/agents/server/agent-service";
import { parseJsonBody } from "@/server/http/request";
import { noContent, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; agentId: string };

export const GET = workspaceRoute<Params>(async ({ membership, params }) => {
  const agent = await getAgent(membership.workspace.id, params.agentId);
  return ok(agent);
});

export const PATCH = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const input = await parseJsonBody(request, updateAgentSchema);
    const agent = await updateAgent({ workspaceId: membership.workspace.id, userId: user.id }, params.agentId, input);
    return ok(agent);
  },
  { minimumRole: "member" },
);

export const DELETE = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    await deleteAgent({ workspaceId: membership.workspace.id, userId: user.id }, params.agentId);
    return noContent();
  },
  { minimumRole: "admin" },
);
