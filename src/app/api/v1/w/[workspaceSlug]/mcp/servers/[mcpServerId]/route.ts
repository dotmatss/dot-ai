import { deleteMcpServer, getMcpServer, updateMcpServer } from "@/features/mcp/server/mcp-service";
import { updateMcpServerSchema } from "@/features/mcp/schemas";
import { assertMcpServerId } from "@/features/mcp/server/mcp-params";
import { parseJsonBody } from "@/server/http/request";
import { noContent, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; mcpServerId: string };

export const GET = workspaceRoute<Params>(async ({ membership, user, params }) => {
  const server = await getMcpServer(
    { workspaceId: membership.workspace.id, userId: user.id },
    assertMcpServerId(params.mcpServerId),
  );
  return ok(server);
});

export const PATCH = workspaceRoute<Params>(
  async ({ membership, user, params, request }) => {
    const input = await parseJsonBody(request, updateMcpServerSchema);
    const server = await updateMcpServer(
      { workspaceId: membership.workspace.id, userId: user.id },
      assertMcpServerId(params.mcpServerId),
      input,
    );
    return ok(server);
  },
  { minimumRole: "admin" },
);

export const DELETE = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    await deleteMcpServer({ workspaceId: membership.workspace.id, userId: user.id }, assertMcpServerId(params.mcpServerId));
    return noContent();
  },
  { minimumRole: "admin" },
);
