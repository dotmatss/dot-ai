import { discoverMcpTools } from "@/features/mcp/server/mcp-service";
import { assertMcpServerId } from "@/features/mcp/server/mcp-params";
import { ApiError } from "@/lib/api/api-error";
import { checkRateLimits } from "@/server/http/rate-limit";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; mcpServerId: string };

/**
 * Re-reads the tool list and stores the snapshot.
 *
 * Grants are never touched here. A tool whose definition changed keeps its
 * grant and is reported stale, which is what stops a re-discovery from
 * quietly re-approving something nobody looked at.
 *
 * Rate limited for the same reason as the probe: it is an outbound request,
 * and discovery follows pagination so it can be several.
 */
export const POST = workspaceRoute<Params>(
  async ({ membership, user, params }) => {
    const serverId = assertMcpServerId(params.mcpServerId);
    const limit = checkRateLimits([
      { key: `mcp-discover:workspace:${membership.workspace.id}`, limit: 20, windowMs: 60_000 },
      { key: `mcp-discover:server:${serverId}`, limit: 6, windowMs: 60_000 },
    ]);
    if (!limit.allowed) throw ApiError.rateLimited(`Too many refreshes. Try again in ${limit.retryAfterSeconds}s.`);

    const outcome = await discoverMcpTools({ workspaceId: membership.workspace.id, userId: user.id }, serverId);
    return ok(outcome);
  },
  { minimumRole: "admin" },
);
