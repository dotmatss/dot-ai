import { setMcpGrants } from "@/features/mcp/server/mcp-service";
import { setMcpGrantsSchema } from "@/features/mcp/schemas";
import { assertMcpServerId } from "@/features/mcp/server/mcp-params";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; mcpServerId: string };

/**
 * Sets which tools are approved.
 *
 * `PUT`, because the body is the complete decision: a tool absent from the
 * list is revoked. `admin`, because approving a destructive tool is a
 * privilege escalation. The approved hash is read from the stored tool on the
 * server and is deliberately not accepted from the request.
 */
export const PUT = workspaceRoute<Params>(
  async ({ membership, user, params, request }) => {
    const input = await parseJsonBody(request, setMcpGrantsSchema);
    const tools = await setMcpGrants(
      { workspaceId: membership.workspace.id, userId: user.id },
      assertMcpServerId(params.mcpServerId),
      input,
    );
    return ok(tools);
  },
  { minimumRole: "admin" },
);
