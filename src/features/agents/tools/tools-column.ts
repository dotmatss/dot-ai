import type { AgentToolSetting } from "@/features/agents/types";
import { toAgentMcpToolEntries, type AgentMcpToolAttachment } from "@/features/mcp/agent-attachment";

/**
 * Composes the whole `agents.tools` jsonb array from its two halves.
 *
 * One column holds two kinds of entry: built-in tool settings, read by
 * `normalizeToolSettings`, and MCP attachments, read by
 * `normalizeAgentMcpTools`. Each normaliser ignores the other's entries, which
 * is what lets them share the column.
 *
 * The trap is on the way out rather than the way in. The column is replaced
 * outright by an update, so writing back only the half you happen to have
 * deletes the other — silently, and only noticed later when an agent stops
 * offering its MCP tools. Every write goes through here so that both halves
 * are always present, and `tests/unit/agents-tools.test.ts` asserts the round
 * trip rather than leaving it to reviewer memory.
 */
export function composeToolsColumn(
  builtIns: ReadonlyArray<AgentToolSetting>,
  mcpAttachments: ReadonlyArray<AgentMcpToolAttachment>,
): Array<AgentToolSetting | AgentMcpToolAttachment> {
  return [...builtIns, ...toAgentMcpToolEntries(mcpAttachments)];
}
