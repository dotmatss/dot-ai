import { agentListQuerySchema, createAgentSchema } from "@/features/agents/schemas";
import { createAgent, getAgents } from "@/features/agents/server/agent-service";
import { parseJsonBody, parseSearchParams } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

export const GET = workspaceRoute(async ({ request, membership }) => {
  const filters = parseSearchParams(request, agentListQuerySchema);
  const page = await getAgents(membership.workspace.id, filters);
  return ok(page);
});

export const POST = workspaceRoute(
  async ({ request, membership, user }) => {
    const input = await parseJsonBody(request, createAgentSchema);
    const agent = await createAgent({ workspaceId: membership.workspace.id, userId: user.id }, input);
    return created(agent);
  },
  { minimumRole: "member" },
);
