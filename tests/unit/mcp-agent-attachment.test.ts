import { describe, expect, it } from "vitest";

import {
  attachedToolRefs,
  enabledMcpToolCount,
  normalizeAgentMcpTools,
  toAgentMcpToolEntries,
  type AttachableServer,
} from "@/features/mcp/agent-attachment";
import { normalizeToolSettings } from "@/features/agents/tools/registry";
import type { McpDiscoveredTool, McpToolGrant } from "@/features/mcp/types";

function tool(name: string, hash: string): McpDiscoveredTool {
  return { name, title: null, description: null, inputSchema: { type: "object" }, outputSchema: null, annotations: {}, contentHash: hash };
}

function grant(toolName: string, approvedHash: string): McpToolGrant {
  return {
    serverId: "srv-1",
    toolName,
    approvedHash,
    riskClass: "read",
    requiresApproval: false,
    state: "active",
    grantedAt: "2026-09-01T00:00:00.000Z",
  };
}

const mcpEntry = { source: "mcp", serverSlug: "crm", toolName: "search_contacts", enabled: true, requiresApproval: false };
const builtinEntry = { toolId: "web_search", enabled: true, config: { maxResults: 5, region: "global" }, requiresApproval: false };

describe("the two normalisers share one column without colliding", () => {
  it("reads MCP entries and ignores built-in ones", () => {
    const attachments = normalizeAgentMcpTools([builtinEntry, mcpEntry]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.toolName).toBe("search_contacts");
  });

  it("leaves the existing built-in normaliser completely unaffected", () => {
    // The point of the additive design: adding MCP entries to an agent's jsonb
    // must not change what the six built-in tools do.
    const withoutMcp = normalizeToolSettings([builtinEntry]);
    const withMcp = normalizeToolSettings([builtinEntry, mcpEntry]);
    expect(withMcp).toEqual(withoutMcp);
    expect(withMcp).toHaveLength(1);
    expect(withMcp[0]?.toolId).toBe("web_search");
  });

  it("survives a row that predates MCP entirely", () => {
    expect(normalizeAgentMcpTools([builtinEntry])).toEqual([]);
    expect(normalizeAgentMcpTools(undefined)).toEqual([]);
    expect(normalizeAgentMcpTools(null)).toEqual([]);
    expect(normalizeAgentMcpTools("tools")).toEqual([]);
  });

  it("skips a malformed MCP entry rather than failing the whole read", () => {
    const attachments = normalizeAgentMcpTools([
      { source: "mcp" },
      { source: "mcp", serverSlug: "", toolName: "x", enabled: true },
      { source: "mcp", serverSlug: "crm", toolName: "  ", enabled: true },
      { source: "mcp", serverSlug: 7, toolName: "x", enabled: true },
      mcpEntry,
    ]);
    expect(attachments.map((attachment) => attachment.toolName)).toEqual(["search_contacts"]);
  });

  it("drops a duplicate attachment after the first", () => {
    const attachments = normalizeAgentMcpTools([mcpEntry, { ...mcpEntry, enabled: false }]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.enabled).toBe(true);
  });

  it("defaults the booleans to false rather than to enabled", () => {
    const attachments = normalizeAgentMcpTools([{ source: "mcp", serverSlug: "crm", toolName: "t" }]);
    expect(attachments[0]).toMatchObject({ enabled: false, requiresApproval: false });
  });

  it("round-trips through serialisation", () => {
    const attachments = normalizeAgentMcpTools([mcpEntry]);
    expect(normalizeAgentMcpTools(toAgentMcpToolEntries(attachments))).toEqual(attachments);
  });
});

describe("what an agent actually offers the model", () => {
  const servers: AttachableServer[] = [
    {
      slug: "crm",
      status: "active",
      tools: [tool("search_contacts", "hash-a"), tool("delete_contact", "hash-d")],
      grants: [grant("search_contacts", "hash-a")],
    },
  ];

  it("offers a tool only when granted, unchanged, attached and enabled", () => {
    expect(attachedToolRefs(servers, normalizeAgentMcpTools([mcpEntry]))).toEqual(["mcp.crm.search_contacts"]);
  });

  it("offers nothing when the attachment is disabled", () => {
    expect(attachedToolRefs(servers, normalizeAgentMcpTools([{ ...mcpEntry, enabled: false }]))).toEqual([]);
  });

  it("offers nothing when the workspace never granted the tool", () => {
    // `delete_contact` exists on the server and is attached to the agent, but
    // nobody approved it. Attaching is not granting.
    const attached = normalizeAgentMcpTools([{ ...mcpEntry, toolName: "delete_contact" }]);
    expect(attachedToolRefs(servers, attached)).toEqual([]);
  });

  it("offers nothing once the grant has gone stale", () => {
    const redefined = [{ ...servers[0]!, tools: [tool("search_contacts", "hash-changed")] }];
    expect(attachedToolRefs(redefined, normalizeAgentMcpTools([mcpEntry]))).toEqual([]);
  });

  it("offers nothing when the server has been removed from the workspace", () => {
    expect(attachedToolRefs([], normalizeAgentMcpTools([mcpEntry]))).toEqual([]);
  });

  it("offers nothing while the server is switched off or unreachable", () => {
    // Offering a tool the resolver is certain to refuse would teach the model
    // about a capability it cannot have, and invite it to keep asking.
    for (const status of ["disabled", "error", "unauthorized", "draft"] as const) {
      const offline = [{ ...servers[0]!, status }];
      expect(attachedToolRefs(offline, normalizeAgentMcpTools([mcpEntry])), status).toEqual([]);
    }
  });

  it("offers nothing when the tool has disappeared from the server", () => {
    const emptied = [{ ...servers[0]!, tools: [] }];
    expect(attachedToolRefs(emptied, normalizeAgentMcpTools([mcpEntry]))).toEqual([]);
  });

  it("counts enabled attachments for the agent summary", () => {
    const attachments = normalizeAgentMcpTools([mcpEntry, { ...mcpEntry, toolName: "other", enabled: false }]);
    expect(enabledMcpToolCount(attachments)).toBe(1);
  });
});
