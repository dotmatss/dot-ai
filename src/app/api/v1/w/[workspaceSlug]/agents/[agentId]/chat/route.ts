import { agentChatSchema } from "@/features/agents/schemas";
import { runAgentChat } from "@/features/agents/server/agent-chat";
import { getAgent } from "@/features/agents/server/agent-service";
import { parseJsonBody } from "@/server/http/request";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; agentId: string };

/** Streaming agent turn for the playground: members may test an agent in any status. */
export const POST = workspaceRoute<Params>(
  async ({ request, membership, user, params }) => {
    const input = await parseJsonBody(request, agentChatSchema);
    const agent = await getAgent(membership.workspace.id, params.agentId);
    return runAgentChat({
      agent,
      input,
      signal: request.signal,
      // Explicit rather than read back out of `metadata`: this identity is
      // recorded against any MCP tool call the turn makes.
      userId: user.id,
      metadata: { userId: user.id },
    });
  },
  { minimumRole: "member" },
);
