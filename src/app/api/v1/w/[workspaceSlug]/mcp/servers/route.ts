import { createMcpServer, listMcpServers } from "@/features/mcp/server/mcp-service";
import { createMcpServerSchema } from "@/features/mcp/schemas";
import { parseJsonBody } from "@/server/http/request";
import { created, ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string };

/** Connected MCP servers. Readable by any member; credentials are never included. */
export const GET = workspaceRoute<Params>(async ({ membership, user }) => {
  const servers = await listMcpServers({ workspaceId: membership.workspace.id, userId: user.id });
  return ok(servers);
});

/**
 * Connects a server.
 *
 * `admin` rather than `member`: connecting a server is the first half of
 * granting an agent reach into an external system, and the second half is also
 * admin-only. A member being able to add the server but not approve its tools
 * would be a confusing split rather than a useful one.
 */
export const POST = workspaceRoute<Params>(
  async ({ membership, user, request }) => {
    const input = await parseJsonBody(request, createMcpServerSchema);
    const server = await createMcpServer({ workspaceId: membership.workspace.id, userId: user.id }, input);
    return created(server);
  },
  { minimumRole: "admin" },
);
