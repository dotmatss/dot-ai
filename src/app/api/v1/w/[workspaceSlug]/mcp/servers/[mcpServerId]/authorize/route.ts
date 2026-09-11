import { getMcpServer } from "@/features/mcp/server/mcp-service";
import { assertMcpServerId } from "@/features/mcp/server/mcp-params";
import { beginMcpOauth, revokeMcpOauth } from "@/features/mcp/server/mcp-oauth";
import { ApiError } from "@/lib/api/api-error";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; mcpServerId: string };

/**
 * Starts an OAuth authorization and returns where to send the person.
 *
 * The URL is returned rather than redirected to, because the caller is a
 * `fetch` from our own UI: a 302 to a third-party origin would be followed by
 * the fetch rather than by the browser, and the person would never see the
 * consent screen.
 *
 * `admin`: authorizing decides what this workspace can reach, and the consent
 * is granted in the name of whoever is signed in at the server.
 */
export const POST = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    const serverId = assertMcpServerId(params.mcpServerId);
    const server = await getMcpServer({ workspaceId: membership.workspace.id, userId: user.id }, serverId);

    if (server.authKind !== "oauth") {
      throw ApiError.badRequest("That server is not configured to use OAuth.");
    }

    const begun = await beginMcpOauth({
      workspaceId: membership.workspace.id,
      userId: user.id,
      serverId,
      endpointUrl: server.endpointUrl,
    });
    if (!begun.ok) throw ApiError.badRequest(begun.reason);

    return ok({ authorizationUrl: begun.authorizationUrl });
  },
  { minimumRole: "admin" },
);

/** Forgets the tokens, so the connection needs authorizing again. */
export const DELETE = workspaceRoute<Params>(
  async ({ membership, params }) => {
    await revokeMcpOauth(membership.workspace.id, assertMcpServerId(params.mcpServerId));
    return ok({ revoked: true });
  },
  { minimumRole: "admin" },
);
