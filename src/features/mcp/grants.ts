import { approvalIsMandatory, suggestRiskClass } from "@/features/mcp/constants";
import { toolRef } from "@/features/mcp/tool-ref";
import type {
  McpDiscoveredTool,
  McpGrantState,
  McpResolutionStatus,
  McpServerStatus,
  McpToolGrant,
  McpToolResolution,
  McpToolView,
} from "@/features/mcp/types";

/**
 * Grants, staleness, and the decision about whether a tool call may proceed.
 *
 * Pure functions on purpose. This is the security decision, and a security
 * decision that can only be exercised by standing up a database and a remote
 * server is a security decision nobody tests. Everything here is a total
 * function over values, so `tests/unit/mcp-grants.test.ts` can enumerate the
 * cases exhaustively — including the ones that matter most, which are the
 * refusals.
 *
 * The caller is responsible for having loaded the grants from the database for
 * the authorised workspace. Nothing here reads a request.
 */

/** True when the tool no longer matches what the customer approved. */
export function isGrantStale(grant: Pick<McpToolGrant, "approvedHash">, tool: Pick<McpDiscoveredTool, "contentHash">): boolean {
  return grant.approvedHash !== tool.contentHash;
}

/**
 * The state a stored grant is actually in, given what the server offers now.
 *
 * Stored state is not trusted for this: the tool list is re-read on every
 * discovery, so the live comparison is what decides. A grant whose tool has
 * vanished becomes `orphaned` rather than being deleted, because a server
 * having a bad day should not silently discard a customer's decisions.
 */
export function grantState(grant: Pick<McpToolGrant, "toolName" | "approvedHash">, tools: ReadonlyArray<McpDiscoveredTool>): McpGrantState {
  const tool = tools.find((candidate) => candidate.name === grant.toolName);
  if (!tool) return "orphaned";
  return isGrantStale(grant, tool) ? "stale" : "active";
}

/** Joins discovered tools to their grants for the approval UI. */
export function toToolViews(tools: ReadonlyArray<McpDiscoveredTool>, grants: ReadonlyArray<McpToolGrant>): McpToolView[] {
  return tools.map((tool) => {
    const grant = grants.find((candidate) => candidate.toolName === tool.name) ?? null;
    return {
      tool,
      grant,
      stale: grant ? isGrantStale(grant, tool) : false,
      suggestedRiskClass: suggestRiskClass(tool.annotations),
    };
  });
}

export interface ResolveMcpToolInput {
  /** The namespaced reference the model asked for. */
  toolRef: string;
  /** Resolved server, or null when the reference names nothing we have. */
  server: { id: string; slug: string; status: McpServerStatus } | null;
  /** Tools currently known for that server. */
  tools: ReadonlyArray<McpDiscoveredTool>;
  /** Grants currently stored for that server. */
  grants: ReadonlyArray<McpToolGrant>;
  toolName: string;
  /**
   * This agent's attachment for the tool, or null when it never attached it.
   * Granting is a workspace decision; attaching is a per-agent one, and both
   * have to hold.
   */
  attachment: { enabled: boolean; requiresApproval: boolean } | null;
  /** When the agent itself is set to pause on every tool call. */
  agentRequiresApproval: boolean;
}

/**
 * Decides what happens to an MCP tool call the model asked for.
 *
 * **Nothing is executed here, and nothing is executed anywhere yet.** Phase 1
 * resolves and records intent, exactly as the six built-in agent tools already
 * do, so MCP does not become the first tool path that can act on the outside
 * world before the execution and approval model is finished. `resolved` means
 * "this call would have been allowed to run", and the recorded call says so.
 *
 * The order of the checks is the point. Existence, then server health, then
 * attachment, then grant, then staleness, then approval. A stale grant is
 * refused *before* the approval question is asked, because approving a call
 * against a tool whose definition changed after it was reviewed would defeat
 * the pinning entirely.
 *
 * Attachment is checked before the grant so an agent is told what it may use,
 * not what the workspace happens to have approved for some other agent.
 */
export function resolveMcpToolCall(input: ResolveMcpToolInput): McpToolResolution {
  const base = { toolRef: input.toolRef, toolName: input.toolName };

  if (!input.server) {
    return {
      ...base,
      status: "unknown_tool",
      serverId: null,
      reason: `“${input.toolRef}” does not name an MCP server connected to this workspace.`,
    };
  }

  const serverId = input.server.id;

  if (input.server.status === "disabled") {
    return { ...base, status: "server_unavailable", serverId, reason: "That MCP server is switched off." };
  }
  if (input.server.status !== "active") {
    return {
      ...base,
      status: "server_unavailable",
      serverId,
      reason: "That MCP server was not reachable the last time we checked, so its tools are not offered.",
    };
  }

  const tool = input.tools.find((candidate) => candidate.name === input.toolName);
  if (!tool) {
    return {
      ...base,
      status: "unknown_tool",
      serverId,
      reason: `“${input.toolName}” is not a tool that server offers.`,
    };
  }

  if (!input.attachment || !input.attachment.enabled) {
    return {
      ...base,
      status: "not_attached",
      serverId,
      reason: `${input.toolName} is not one of the tools this agent may use.`,
    };
  }

  const grant = input.grants.find((candidate) => candidate.toolName === input.toolName);
  if (!grant) {
    return {
      ...base,
      status: "not_granted",
      serverId,
      reason: `${input.toolName} has not been approved for use in this workspace.`,
    };
  }

  if (isGrantStale(grant, tool)) {
    return {
      ...base,
      status: "stale_grant",
      serverId,
      reason: `${input.toolName} has changed since it was approved, so it needs reviewing again before it can be used.`,
    };
  }

  if (
    input.agentRequiresApproval ||
    input.attachment.requiresApproval ||
    grant.requiresApproval ||
    approvalIsMandatory(grant.riskClass)
  ) {
    const why = input.agentRequiresApproval
      ? "This agent pauses for approval on every tool call"
      : approvalIsMandatory(grant.riskClass)
        ? `${input.toolName} is classified as destructive, which always requires approval`
        : `${input.toolName} is set to require approval`;
    return { ...base, status: "approval_required", serverId, reason: `${why}, so the call is waiting for a person.` };
  }

  return {
    ...base,
    status: "resolved",
    serverId,
    reason: `${input.toolName} is approved. Tool execution is not connected yet, so the call was recorded instead of run.`,
  };
}

/** Statuses that mean the model's request did not go through. */
const REFUSALS: ReadonlySet<McpResolutionStatus> = new Set([
  "not_granted",
  "not_attached",
  "stale_grant",
  "server_unavailable",
  "unknown_tool",
]);

export function isRefusal(status: McpResolutionStatus): boolean {
  return REFUSALS.has(status);
}

/** Reference for a tool on a server, for building the model's tool list. */
export function grantedToolRefs(
  server: { slug: string; status: McpServerStatus },
  tools: ReadonlyArray<McpDiscoveredTool>,
  grants: ReadonlyArray<McpToolGrant>,
): string[] {
  if (server.status !== "active") return [];
  return tools
    .filter((tool) => {
      const grant = grants.find((candidate) => candidate.toolName === tool.name);
      return Boolean(grant) && !isGrantStale(grant!, tool);
    })
    .map((tool) => toolRef(server.slug, tool.name));
}
