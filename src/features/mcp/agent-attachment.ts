import { toolRef } from "@/features/mcp/tool-ref";
import type { McpDiscoveredTool, McpServerStatus, McpToolGrant } from "@/features/mcp/types";

/**
 * How an agent is attached to MCP tools.
 *
 * ## Two levels, and why
 *
 * A workspace grants a tool once, by hand, pinned to a content hash: that is
 * the security decision and it lives in the MCP domain. An agent then selects
 * from what the workspace already granted: that is a configuration choice and
 * it lives with the agent, in the `agents.tools` jsonb column, beside the
 * built-in tool settings.
 *
 * Granting is not attaching. A workspace can grant `delete_contact` for one
 * carefully supervised agent without every agent acquiring it, which is the
 * "do not automatically grant every discovered tool" requirement made
 * structural rather than advisory.
 *
 * ## Why this is additive rather than a change to AgentToolSetting
 *
 * `agents.tools` is a jsonb array. `normalizeToolSettings` in the agents
 * feature keeps only entries whose `toolId` is a known built-in id and drops
 * everything else, so MCP entries in that same array are invisible to it and
 * always have been. This module reads the other half of the array. Neither
 * normaliser can break the other, no existing row needs rewriting, and no
 * migration is involved — the column already exists and already tolerates
 * entries it does not recognise.
 */

export interface AgentMcpToolAttachment {
  /** Discriminant stored in the jsonb entry. */
  source: "mcp";
  /** Our slug for the server, not the server's self-reported name. */
  serverSlug: string;
  toolName: string;
  enabled: boolean;
  /**
   * Per-agent approval override. It can only ever make approval MORE likely:
   * the workspace grant and the destructive class both still apply, and
   * `resolveMcpToolCall` checks all three.
   */
  requiresApproval: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the MCP half of an agent's `tools` jsonb.
 *
 * Tolerant by design, like its built-in counterpart: a row can predate a
 * change, so an unrecognised entry is skipped rather than failing the read of
 * the whole agent.
 */
export function normalizeAgentMcpTools(value: unknown): AgentMcpToolAttachment[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const out: AgentMcpToolAttachment[] = [];

  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    if (entry.source !== "mcp") continue;

    const serverSlug = typeof entry.serverSlug === "string" ? entry.serverSlug.trim() : "";
    const toolName = typeof entry.toolName === "string" ? entry.toolName.trim() : "";
    if (!serverSlug || !toolName) continue;

    const key = `${serverSlug}/${toolName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      source: "mcp",
      serverSlug,
      toolName,
      enabled: entry.enabled === true,
      requiresApproval: entry.requiresApproval === true,
    });
  }

  return out;
}

/** Serialises attachments back into jsonb entries. */
export function toAgentMcpToolEntries(attachments: ReadonlyArray<AgentMcpToolAttachment>): AgentMcpToolAttachment[] {
  return attachments.map((attachment) => ({
    source: "mcp",
    serverSlug: attachment.serverSlug,
    toolName: attachment.toolName,
    enabled: attachment.enabled,
    requiresApproval: attachment.requiresApproval,
  }));
}

export interface AttachableServer {
  slug: string;
  /**
   * Required, so a server that is switched off or was unreachable at the last
   * probe cannot have its tools offered. Without this the model would be told
   * about a tool that resolution is certain to refuse.
   */
  status: McpServerStatus;
  tools: ReadonlyArray<McpDiscoveredTool>;
  grants: ReadonlyArray<McpToolGrant>;
}

/**
 * The MCP tools this agent would actually offer the model.
 *
 * Deliberately an intersection of five conditions rather than a lookup: the
 * server is active, the workspace granted it, the grant is not stale, the
 * agent attached it, and the attachment is enabled. Dropping any one of those
 * would let a tool reach a model on the strength of a single click somewhere.
 */
export function attachedToolRefs(
  servers: ReadonlyArray<AttachableServer>,
  attachments: ReadonlyArray<AgentMcpToolAttachment>,
): string[] {
  const refs: string[] = [];

  for (const attachment of attachments) {
    if (!attachment.enabled) continue;
    const server = servers.find((candidate) => candidate.slug === attachment.serverSlug);
    if (!server) continue;
    if (server.status !== "active") continue;

    const tool = server.tools.find((candidate) => candidate.name === attachment.toolName);
    if (!tool) continue;

    const grant = server.grants.find((candidate) => candidate.toolName === attachment.toolName);
    if (!grant || grant.approvedHash !== tool.contentHash) continue;

    refs.push(toolRef(server.slug, tool.name));
  }

  return refs;
}

/** Count for the agent summary, so the UI can distinguish the two sources. */
export function enabledMcpToolCount(attachments: ReadonlyArray<AgentMcpToolAttachment>): number {
  return attachments.filter((attachment) => attachment.enabled).length;
}
