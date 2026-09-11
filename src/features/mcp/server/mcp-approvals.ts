import "server-only";

import { findAgentById } from "@/features/agents/server/agent-repository";
import { isRefusal, resolveMcpToolCall } from "@/features/mcp/grants";
import { runCall } from "@/features/mcp/server/mcp-execution";
import * as repository from "@/features/mcp/server/mcp-repository";
import { parseToolRef } from "@/features/mcp/tool-ref";
import type { McpToolCall } from "@/features/mcp/types";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";

/**
 * The approvals queue.
 *
 * Phase 2b made `approval_required` a real state rather than a dead end: a
 * call that needs a person is recorded as `awaiting_approval` and waits. This
 * module is what a person acts through.
 *
 * Two rules shape everything here.
 *
 * **Approval is not a bypass.** Saying yes does not run whatever was queued;
 * it authorises one call which is then re-checked from scratch. A queued call
 * can sit for a day, and in that time a grant can be revoked, a tool
 * redefined, a server switched off or the agent reconfigured. If any of that
 * happened, the approval is honoured as a *decision* and the call is still
 * refused — recorded with the reason, rather than run because somebody clicked
 * yes before the world changed.
 *
 * **A decision happens once.** The transition out of `awaiting_approval` is
 * conditional on the row still being in it, so two reviewers with the queue
 * open cannot both run the same call.
 */

export interface McpApprovalContext {
  workspaceId: string;
  userId: string;
}

export function listMcpApprovals(ctx: McpApprovalContext): Promise<McpToolCall[]> {
  return repository.listPendingToolCalls(ctx.workspaceId);
}

/** Recent calls, decisions and refusals alike. The audit view. */
export function listMcpToolCalls(ctx: McpApprovalContext, limit = 50): Promise<McpToolCall[]> {
  return repository.listRecentToolCalls(ctx.workspaceId, Math.min(Math.max(limit, 1), 200));
}

async function loadPending(ctx: McpApprovalContext, callId: string): Promise<McpToolCall> {
  const call = await repository.findToolCallById(ctx.workspaceId, callId);
  if (!call) throw ApiError.notFound("That tool call was not found");
  if (call.status !== "awaiting_approval") {
    throw ApiError.conflict("That tool call has already been decided.");
  }
  return call;
}

export async function denyMcpToolCall(ctx: McpApprovalContext, callId: string): Promise<McpToolCall> {
  const call = await loadPending(ctx, callId);

  const changed = await repository.decideToolCall(ctx.workspaceId, callId, { status: "denied", decidedBy: ctx.userId });
  if (!changed) throw ApiError.conflict("That tool call has already been decided.");

  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: "mcp.tool_call.denied",
    entityType: "mcp_tool_call",
    entityId: callId,
    // The tool name, never the arguments: those can carry customer data and an
    // activity feed is read more widely than the queue.
    summary: `Denied ${call.toolName}`,
  });

  const updated = await repository.findToolCallById(ctx.workspaceId, callId);
  if (!updated) throw ApiError.notFound("That tool call was not found");
  return updated;
}

/**
 * Approves a queued call and runs it.
 *
 * The re-check is the point. Everything the original decision depended on is
 * read again here, and a call that would no longer be allowed is refused with
 * the reason recorded, even though a person approved it.
 */
export async function approveMcpToolCall(ctx: McpApprovalContext, callId: string): Promise<McpToolCall> {
  const call = await loadPending(ctx, callId);

  const parsed = parseToolRef(call.toolRef);
  const bundles = parsed ? await repository.loadServerBundles(ctx.workspaceId, [parsed.serverSlug]) : [];
  const bundle = bundles[0] ?? null;

  // The agent's own configuration can have changed too: a tool it no longer
  // offers must not run just because a queued call still names it.
  const agent = call.agentId ? await findAgentById(ctx.workspaceId, call.agentId) : null;
  const attachment = parsed
    ? (agent?.mcpTools.find(
        (candidate) => candidate.serverSlug === parsed.serverSlug && candidate.toolName === parsed.toolName,
      ) ?? null)
    : null;

  const resolution = parsed
    ? resolveMcpToolCall({
        toolRef: call.toolRef,
        server: bundle ? { id: bundle.server.id, slug: bundle.server.slug, status: bundle.server.status } : null,
        tools: bundle?.tools ?? [],
        grants: bundle?.grants ?? [],
        toolName: parsed.toolName,
        attachment: attachment ? { enabled: attachment.enabled, requiresApproval: attachment.requiresApproval } : null,
        // The approval that is being given here IS the answer to the agent's
        // pause, so it must not be re-asked or nothing could ever run.
        agentRequiresApproval: false,
      })
    : null;

  const tool = parsed ? bundle?.tools.find((candidate) => candidate.name === parsed.toolName) : undefined;

  if (!parsed || !resolution || !bundle || !tool || isRefusal(resolution.status)) {
    const reason = resolution && isRefusal(resolution.status) ? resolution.reason : "That tool is no longer available.";
    const changed = await repository.decideToolCall(ctx.workspaceId, callId, {
      status: "refused",
      decidedBy: ctx.userId,
      errorMessage: reason,
    });
    if (!changed) throw ApiError.conflict("That tool call has already been decided.");

    await recordActivity({
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: "mcp.tool_call.refused_on_approval",
      entityType: "mcp_tool_call",
      entityId: callId,
      summary: `${call.toolName} could not be run: ${reason}`,
    });

    const refused = await repository.findToolCallById(ctx.workspaceId, callId);
    if (!refused) throw ApiError.notFound("That tool call was not found");
    return refused;
  }

  // Claim the call before running it, so a second reviewer cannot run it too.
  const claimed = await repository.decideToolCall(ctx.workspaceId, callId, { status: "running", decidedBy: ctx.userId });
  if (!claimed) throw ApiError.conflict("That tool call has already been decided.");

  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    action: "mcp.tool_call.approved",
    entityType: "mcp_tool_call",
    entityId: callId,
    summary: `Approved ${call.toolName} on ${bundle.server.name}`,
  });

  // Arguments come from the stored row, not from the request. A reviewer
  // approves the call they were shown; they do not get to edit it on the way
  // through, and nor does anything else.
  const args =
    call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments)
      ? (call.arguments as Record<string, unknown>)
      : {};

  await runCall({
    workspaceId: ctx.workspaceId,
    callId,
    serverId: bundle.server.id,
    serverName: bundle.server.name,
    endpointUrl: bundle.server.endpointUrl,
    authKind: bundle.server.authKind,
    toolRef: call.toolRef,
    toolName: parsed.toolName,
    resolution: "resolved",
    args,
  });

  const finished = await repository.findToolCallById(ctx.workspaceId, callId);
  if (!finished) throw ApiError.notFound("That tool call was not found");
  return finished;
}
