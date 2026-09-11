import { listMcpToolCalls } from "@/features/mcp/server/mcp-approvals";
import { mcpCallsQuerySchema } from "@/features/mcp/schemas";
import { parseSearchParams } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string };

/**
 * Recent tool calls: what ran, what was refused and why.
 *
 * Refusals are included deliberately. A log that only shows successes cannot
 * answer the question an operator actually has, which is whether anything
 * tried.
 */
export const GET = workspaceRoute<Params>(
  async ({ membership, user, request }) => {
    const query = parseSearchParams(request, mcpCallsQuerySchema);
    const calls = await listMcpToolCalls({ workspaceId: membership.workspace.id, userId: user.id }, query.limit);
    return ok(calls);
  },
  { minimumRole: "admin" },
);
