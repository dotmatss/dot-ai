import { listMcpTools } from "@/features/mcp/server/mcp-service";
import { assertMcpServerId } from "@/features/mcp/server/mcp-params";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; mcpServerId: string };

/**
 * The stored tool snapshot joined to its grants.
 *
 * A read, so `viewer` is enough. Tool descriptions and schemas come from a
 * third-party server and are shown as such; nothing here is a credential.
 */
export const GET = workspaceRoute<Params>(async ({ membership, user, params }) => {
  const tools = await listMcpTools(
    { workspaceId: membership.workspace.id, userId: user.id },
    assertMcpServerId(params.mcpServerId),
  );
  return ok(tools);
});
