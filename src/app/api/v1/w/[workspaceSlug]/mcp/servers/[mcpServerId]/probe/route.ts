import { probeMcpServer } from "@/features/mcp/server/mcp-service";
import { assertMcpServerId } from "@/features/mcp/server/mcp-params";
import { ApiError } from "@/lib/api/api-error";
import { checkRateLimits } from "@/server/http/rate-limit";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; mcpServerId: string };

/**
 * Checks that a configured server answers.
 *
 * This makes an outbound request to an address the workspace chose, so it is
 * rate limited as well as authorized. Even with the egress guard refusing
 * private destinations, an unbounded probe endpoint is a convenient amplifier
 * and a port scanner. Both ceilings are keyed on server-derived ids, so a
 * caller cannot rotate away from them.
 */
export const POST = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    const serverId = assertMcpServerId(params.mcpServerId);
    const limit = checkRateLimits([
      { key: `mcp-probe:workspace:${membership.workspace.id}`, limit: 30, windowMs: 60_000 },
      { key: `mcp-probe:server:${serverId}`, limit: 10, windowMs: 60_000 },
    ]);
    if (!limit.allowed) throw ApiError.rateLimited(`Too many connection tests. Try again in ${limit.retryAfterSeconds}s.`);

    const outcome = await probeMcpServer({ workspaceId: membership.workspace.id, userId: user.id }, serverId);
    return ok(outcome);
  },
  { minimumRole: "admin" },
);
