import { describe, expect, it } from "vitest";

import { approvalIsMandatory, defaultRequiresApproval, suggestRiskClass } from "@/features/mcp/constants";
import { grantState, grantedToolRefs, isGrantStale, isRefusal, resolveMcpToolCall, toToolViews } from "@/features/mcp/grants";
import { isMcpToolRef, parseToolRef, toolRef } from "@/features/mcp/tool-ref";
import type { McpDiscoveredTool, McpServerStatus, McpToolGrant } from "@/features/mcp/types";

function tool(name: string, hash: string, annotations: McpDiscoveredTool["annotations"] = {}): McpDiscoveredTool {
  return { name, title: null, description: null, inputSchema: { type: "object" }, outputSchema: null, annotations, contentHash: hash };
}

function grant(toolName: string, approvedHash: string, overrides: Partial<McpToolGrant> = {}): McpToolGrant {
  return {
    serverId: "srv-1",
    toolName,
    approvedHash,
    riskClass: "read",
    requiresApproval: false,
    state: "active",
    grantedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const server = { id: "srv-1", slug: "crm", status: "active" as McpServerStatus };

function resolve(overrides: Partial<Parameters<typeof resolveMcpToolCall>[0]> = {}) {
  return resolveMcpToolCall({
    toolRef: toolRef("crm", "search_contacts"),
    server,
    tools: [tool("search_contacts", "hash-a")],
    grants: [grant("search_contacts", "hash-a")],
    toolName: "search_contacts",
    attachment: { enabled: true, requiresApproval: false },
    agentRequiresApproval: false,
    ...overrides,
  });
}

describe("tool references", () => {
  it("namespaces a tool by our own server slug", () => {
    expect(toolRef("crm", "search_contacts")).toBe("mcp.crm.search_contacts");
  });

  it("round-trips a tool name that itself contains dots", () => {
    // The spec allows `admin.tools.list`. Splitting naively would truncate it
    // and resolve the wrong tool, or none.
    const ref = toolRef("crm", "admin.tools.list");
    expect(parseToolRef(ref)).toEqual({ serverSlug: "crm", toolName: "admin.tools.list" });
  });

  it("rejects anything that is not an MCP reference", () => {
    expect(parseToolRef("web_search")).toBeNull();
    expect(parseToolRef("mcp.crm")).toBeNull();
    expect(parseToolRef("mcp..search")).toBeNull();
    expect(parseToolRef("other.crm.search")).toBeNull();
    expect(isMcpToolRef("http_request")).toBe(false);
    expect(isMcpToolRef("mcp.crm.search")).toBe(true);
  });
});

describe("risk suggestion is advisory", () => {
  it("suggests read only when the server claims read-only", () => {
    expect(suggestRiskClass({ readOnlyHint: true })).toBe("read");
  });

  it("suggests destructive when the server claims destructive", () => {
    expect(suggestRiskClass({ destructiveHint: true })).toBe("destructive");
  });

  it("defaults to write when the server says nothing", () => {
    // Silence is not evidence of harmlessness.
    expect(suggestRiskClass({})).toBe("write");
    expect(suggestRiskClass({ idempotentHint: true })).toBe("write");
  });

  it("treats destructive as destructive even when also claimed read-only", () => {
    // A contradictory pair is a reason for suspicion, not for the softer read.
    expect(suggestRiskClass({ readOnlyHint: true, destructiveHint: true })).toBe("destructive");
  });

  it("requires approval by default for anything that is not a read", () => {
    expect(defaultRequiresApproval("read")).toBe(false);
    expect(defaultRequiresApproval("write")).toBe(true);
    expect(defaultRequiresApproval("destructive")).toBe(true);
  });

  it("makes approval mandatory for destructive tools", () => {
    expect(approvalIsMandatory("destructive")).toBe(true);
    expect(approvalIsMandatory("write")).toBe(false);
  });
});

describe("grant staleness", () => {
  it("is fresh while the hash matches", () => {
    expect(isGrantStale(grant("t", "hash-a"), tool("t", "hash-a"))).toBe(false);
  });

  it("is stale once the tool is redefined", () => {
    expect(isGrantStale(grant("t", "hash-a"), tool("t", "hash-b"))).toBe(true);
  });

  it("reports the live state rather than trusting the stored one", () => {
    const tools = [tool("t", "hash-b")];
    // The stored record still says "active"; the live comparison decides.
    expect(grantState(grant("t", "hash-a", { state: "active" }), tools)).toBe("stale");
    expect(grantState(grant("t", "hash-b"), tools)).toBe("active");
  });

  it("orphans a grant whose tool has disappeared rather than deleting it", () => {
    expect(grantState(grant("gone", "hash-a"), [tool("t", "hash-a")])).toBe("orphaned");
  });
});

describe("tool views for the approval UI", () => {
  it("joins tools to grants and flags staleness", () => {
    const views = toToolViews(
      [tool("a", "hash-a", { readOnlyHint: true }), tool("b", "hash-new"), tool("c", "hash-c")],
      [grant("a", "hash-a"), grant("b", "hash-old")],
    );

    expect(views.map((view) => [view.tool.name, Boolean(view.grant), view.stale])).toEqual([
      ["a", true, false],
      ["b", true, true],
      ["c", false, false],
    ]);
    expect(views[0]?.suggestedRiskClass).toBe("read");
    expect(views[2]?.suggestedRiskClass).toBe("write");
  });
});

describe("resolving a tool call", () => {
  it("resolves an approved, unchanged, read-only tool", () => {
    const result = resolve();
    expect(result.status).toBe("resolved");
    expect(result.serverId).toBe("srv-1");
    // Phase 1 records rather than runs, and says so.
    expect(result.reason).toMatch(/not connected yet/i);
  });

  it("refuses a tool that was never approved", () => {
    expect(resolve({ grants: [] }).status).toBe("not_granted");
  });

  it("refuses a tool the server does not offer", () => {
    expect(resolve({ tools: [] }).status).toBe("unknown_tool");
  });

  it("refuses a reference to a server this workspace does not have", () => {
    const result = resolve({ server: null });
    expect(result.status).toBe("unknown_tool");
    expect(result.serverId).toBeNull();
  });

  it("refuses when the server is disabled", () => {
    expect(resolve({ server: { ...server, status: "disabled" } }).status).toBe("server_unavailable");
  });

  it("refuses when the server last failed its probe", () => {
    for (const status of ["error", "unauthorized", "draft"] as const) {
      expect(resolve({ server: { ...server, status } }).status, status).toBe("server_unavailable");
    }
  });

  it("refuses a stale grant, and does so BEFORE asking about approval", () => {
    // This ordering is the whole point of hash pinning. If approval were asked
    // first, a person could approve a call against a definition nobody
    // reviewed, and the pinning would be decorative.
    const result = resolve({
      tools: [tool("search_contacts", "hash-changed")],
      grants: [grant("search_contacts", "hash-a", { requiresApproval: true })],
    });
    expect(result.status).toBe("stale_grant");
    expect(result.reason).toMatch(/changed since it was approved/i);
  });

  it("requires approval when the grant asks for it", () => {
    const result = resolve({ grants: [grant("search_contacts", "hash-a", { requiresApproval: true })] });
    expect(result.status).toBe("approval_required");
  });

  it("requires approval when the agent pauses on every call", () => {
    expect(resolve({ agentRequiresApproval: true }).status).toBe("approval_required");
  });

  it("requires approval for a destructive tool even when the grant says otherwise", () => {
    // A configuration mistake must not be able to switch this off.
    const result = resolve({
      grants: [grant("search_contacts", "hash-a", { riskClass: "destructive", requiresApproval: false })],
    });
    expect(result.status).toBe("approval_required");
    expect(result.reason).toMatch(/destructive/i);
  });

  it("refuses a tool the workspace granted but this agent never attached", () => {
    // Granting is not attaching. A workspace can approve a tool for one
    // carefully supervised agent without every agent acquiring it.
    const result = resolve({ attachment: null });
    expect(result.status).toBe("not_attached");
    expect(result.reason).toMatch(/this agent may use/i);
  });

  it("refuses a tool whose attachment has been switched off", () => {
    expect(resolve({ attachment: { enabled: false, requiresApproval: false } }).status).toBe("not_attached");
  });

  it("checks attachment before the grant, so the model learns nothing about other agents' approvals", () => {
    const result = resolve({ attachment: null, grants: [] });
    expect(result.status).toBe("not_attached");
  });

  it("requires approval when only the agent's attachment asks for it", () => {
    // The per-agent override can make approval more likely, never less.
    const result = resolve({ attachment: { enabled: true, requiresApproval: true } });
    expect(result.status).toBe("approval_required");
  });

  it("classifies which statuses are refusals", () => {
    expect(isRefusal("not_granted")).toBe(true);
    expect(isRefusal("not_attached")).toBe(true);
    expect(isRefusal("stale_grant")).toBe(true);
    expect(isRefusal("server_unavailable")).toBe(true);
    expect(isRefusal("unknown_tool")).toBe(true);
    expect(isRefusal("resolved")).toBe(false);
    expect(isRefusal("approval_required")).toBe(false);
  });
});

describe("the tool list offered to the model", () => {
  it("offers only granted, unchanged tools", () => {
    const refs = grantedToolRefs(
      server,
      [tool("a", "hash-a"), tool("b", "hash-new"), tool("c", "hash-c")],
      [grant("a", "hash-a"), grant("b", "hash-old")],
    );
    expect(refs).toEqual(["mcp.crm.a"]);
  });

  it("offers nothing from a server that is not active", () => {
    for (const status of ["draft", "error", "unauthorized", "disabled"] as const) {
      expect(grantedToolRefs({ ...server, status }, [tool("a", "hash-a")], [grant("a", "hash-a")]), status).toEqual([]);
    }
  });

  it("offers nothing when nothing has been granted", () => {
    expect(grantedToolRefs(server, [tool("a", "hash-a")], [])).toEqual([]);
  });
});
