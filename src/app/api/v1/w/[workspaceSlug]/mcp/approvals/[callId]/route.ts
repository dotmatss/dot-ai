import { approveMcpToolCall, denyMcpToolCall } from "@/features/mcp/server/mcp-approvals";
import { decideMcpToolCallSchema } from "@/features/mcp/schemas";
import { assertMcpCallId } from "@/features/mcp/server/mcp-params";
import { parseJsonBody } from "@/server/http/request";
import { ok } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

type Params = { workspaceSlug: string; callId: string };

/**
 * Decides one queued call.
 *
 * The decision is the only thing the request carries. The tool, the server and
 * the arguments all come from the stored row, so a reviewer approves the call
 * they were shown rather than one assembled in the request. Approving
 * re-checks the grant, the content hash, the server and the agent's own
 * configuration before anything runs.
 */
export const POST = workspaceRoute<Params>(
  async ({ membership, user, params, request }) => {
    const input = await parseJsonBody(request, decideMcpToolCallSchema);
    const ctx = { workspaceId: membership.workspace.id, userId: user.id };
    const callId = assertMcpCallId(params.callId);

    const call = input.decision === "approve" ? await approveMcpToolCall(ctx, callId) : await denyMcpToolCall(ctx, callId);
    return ok(call);
  },
  { minimumRole: "admin" },
);
