// @vitest-environment node
/**
 * The approvals queue.
 *
 * The property under test throughout is that **approving is not bypassing**. A
 * queued call can sit for a day; in that time a grant can be revoked, a tool
 * redefined, a server switched off or the agent reconfigured. Saying yes
 * authorises one call, which is then re-checked from scratch — so a click made
 * before the world changed cannot run something that is no longer allowed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { McpDiscoveredTool, McpServer, McpServerStatus, McpToolCall, McpToolGrant } from "@/features/mcp/types";
import { ApiError } from "@/lib/api/api-error";

const findToolCallById = vi.hoisted(() => vi.fn());
const listPendingToolCalls = vi.hoisted(() => vi.fn());
const listRecentToolCalls = vi.hoisted(() => vi.fn());
const decideToolCall = vi.hoisted(() => vi.fn());
const loadServerBundles = vi.hoisted(() => vi.fn());
vi.mock("@/features/mcp/server/mcp-repository", () => ({
  findToolCallById,
  listPendingToolCalls,
  listRecentToolCalls,
  decideToolCall,
  loadServerBundles,
}));

const runCall = vi.hoisted(() => vi.fn());
vi.mock("@/features/mcp/server/mcp-execution", () => ({ runCall }));

const findAgentById = vi.hoisted(() => vi.fn());
vi.mock("@/features/agents/server/agent-repository", () => ({ findAgentById }));

const recordActivity = vi.hoisted(() => vi.fn());
vi.mock("@/server/activity/activity-log", () => ({ recordActivity }));

const { approveMcpToolCall, denyMcpToolCall, listMcpApprovals } = await import("@/features/mcp/server/mcp-approvals");

const CTX = { workspaceId: "ws-1", userId: "reviewer-1" };
const CALL_ID = "11111111-1111-1111-1111-111111111111";

function pendingCall(overrides: Partial<McpToolCall> = {}): McpToolCall {
  return {
    id: CALL_ID,
    serverId: "srv-1",
    serverName: "Acme CRM",
    agentId: "a-1",
    agentName: "Ops",
    conversationId: "c-1",
    toolRef: "mcp.crm.delete_contact",
    toolName: "delete_contact",
    status: "awaiting_approval",
    resolution: "approval_required",
    riskClass: "destructive",
    arguments: { id: "contact-9" },
    result: null,
    resultBytes: null,
    resultTruncated: false,
    isError: false,
    errorMessage: null,
    durationMs: null,
    decidedAt: null,
    createdAt: "2026-09-11T00:00:00.000Z",
    ...overrides,
  };
}

function tool(overrides: Partial<McpDiscoveredTool> = {}): McpDiscoveredTool {
  return {
    name: "delete_contact",
    title: null,
    description: "Deletes a contact.",
    inputSchema: { type: "object", properties: { id: {} } },
    outputSchema: null,
    annotations: {},
    contentHash: "hash-delete",
    ...overrides,
  };
}

function grant(overrides: Partial<McpToolGrant> = {}): McpToolGrant {
  return {
    serverId: "srv-1",
    toolName: "delete_contact",
    approvedHash: "hash-delete",
    riskClass: "destructive",
    requiresApproval: true,
    state: "active",
    grantedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function server(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "srv-1",
    workspaceId: "ws-1",
    name: "Acme CRM",
    slug: "crm",
    endpointUrl: "https://mcp.example.com/mcp",
    transport: "http",
    authKind: "none",
    status: "active" as McpServerStatus,
    hasCredential: false,
    credentialHeader: null,
    hasOauthToken: false,
    oauthNeedsScope: null,
    toolCount: 1,
    grantedToolCount: 1,
    staleGrantCount: 0,
    lastProbeAt: null,
    lastProbeOk: true,
    lastProbeMessage: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function bundle(options: { tools?: McpDiscoveredTool[]; grants?: McpToolGrant[]; status?: McpServerStatus } = {}) {
  return [
    {
      server: server(options.status ? { status: options.status } : {}),
      tools: options.tools ?? [tool()],
      grants: options.grants ?? [grant()],
    },
  ];
}

function agentWith(attachments: Array<{ serverSlug: string; toolName: string; enabled: boolean; requiresApproval: boolean }>) {
  return {
    id: "a-1",
    requiresApproval: false,
    mcpTools: attachments.map((entry) => ({ source: "mcp" as const, ...entry })),
  };
}

/** The status of each decideToolCall attempt, in order. */
function decisions(): string[] {
  return decideToolCall.mock.calls.map((call) => (call[2] as { status: string }).status);
}

beforeEach(() => {
  findToolCallById.mockReset();
  listPendingToolCalls.mockReset();
  listRecentToolCalls.mockReset();
  decideToolCall.mockReset();
  loadServerBundles.mockReset();
  runCall.mockReset();
  findAgentById.mockReset();
  recordActivity.mockReset();

  findToolCallById.mockResolvedValue(pendingCall());
  decideToolCall.mockResolvedValue(true);
  loadServerBundles.mockResolvedValue(bundle());
  runCall.mockResolvedValue({ callId: CALL_ID, status: "executed", resolution: "resolved", resultText: "ok", message: "ran", isError: false });
  findAgentById.mockResolvedValue(
    agentWith([{ serverSlug: "crm", toolName: "delete_contact", enabled: true, requiresApproval: true }]),
  );
  recordActivity.mockResolvedValue(undefined);
  listPendingToolCalls.mockResolvedValue([pendingCall()]);
});

describe("the queue", () => {
  it("lists what is waiting", async () => {
    const calls = await listMcpApprovals(CTX);
    expect(calls).toHaveLength(1);
    expect(listPendingToolCalls).toHaveBeenCalledWith("ws-1");
  });
});

describe("denying", () => {
  it("records the denial and runs nothing", async () => {
    findToolCallById.mockResolvedValueOnce(pendingCall()).mockResolvedValueOnce(pendingCall({ status: "denied" }));

    const call = await denyMcpToolCall(CTX, CALL_ID);

    expect(call.status).toBe("denied");
    expect(decisions()).toEqual(["denied"]);
    expect(runCall).not.toHaveBeenCalled();
  });

  it("refuses a call that was already decided", async () => {
    findToolCallById.mockResolvedValue(pendingCall({ status: "executed" }));
    await expect(denyMcpToolCall(CTX, CALL_ID)).rejects.toBeInstanceOf(ApiError);
    expect(decideToolCall).not.toHaveBeenCalled();
  });

  it("does not name the arguments in the activity feed", async () => {
    // The feed is read more widely than the queue, and arguments are customer
    // data proposed by a model.
    await denyMcpToolCall(CTX, CALL_ID);
    expect(JSON.stringify(recordActivity.mock.calls)).not.toContain("contact-9");
  });
});

describe("approving re-checks everything first", () => {
  it("runs the call when nothing has changed", async () => {
    await approveMcpToolCall(CTX, CALL_ID);

    expect(decisions()).toEqual(["running"]);
    expect(runCall).toHaveBeenCalledTimes(1);
    expect(runCall.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: "ws-1",
      callId: CALL_ID,
      toolName: "delete_contact",
      serverId: "srv-1",
    });
  });

  it("refuses a grant revoked while the call was waiting", async () => {
    loadServerBundles.mockResolvedValue(bundle({ grants: [] }));

    const call = await approveMcpToolCall(CTX, CALL_ID);

    expect(runCall).not.toHaveBeenCalled();
    expect(decisions()).toEqual(["refused"]);
    expect(decideToolCall.mock.calls[0]?.[2]).toMatchObject({ errorMessage: expect.stringMatching(/not been approved/i) });
    expect(call).toBeDefined();
  });

  it("refuses a tool redefined while the call was waiting", async () => {
    // The pin is what makes this detectable: same name, different definition.
    loadServerBundles.mockResolvedValue(bundle({ tools: [tool({ contentHash: "hash-rewritten" })] }));

    await approveMcpToolCall(CTX, CALL_ID);

    expect(runCall).not.toHaveBeenCalled();
    expect(decideToolCall.mock.calls[0]?.[2]).toMatchObject({
      status: "refused",
      errorMessage: expect.stringMatching(/changed since it was approved/i),
    });
  });

  it("refuses once the server has been switched off", async () => {
    loadServerBundles.mockResolvedValue(bundle({ status: "disabled" }));
    await approveMcpToolCall(CTX, CALL_ID);
    expect(runCall).not.toHaveBeenCalled();
    expect(decisions()).toEqual(["refused"]);
  });

  it("refuses once the agent no longer offers the tool", async () => {
    // Approving a call for an agent that has since been reconfigured would run
    // something its current configuration forbids.
    findAgentById.mockResolvedValue(agentWith([]));

    await approveMcpToolCall(CTX, CALL_ID);

    expect(runCall).not.toHaveBeenCalled();
    expect(decideToolCall.mock.calls[0]?.[2]).toMatchObject({ errorMessage: expect.stringMatching(/this agent may use/i) });
  });

  it("refuses when the whole server has been removed", async () => {
    loadServerBundles.mockResolvedValue([]);
    await approveMcpToolCall(CTX, CALL_ID);
    expect(runCall).not.toHaveBeenCalled();
    expect(decisions()).toEqual(["refused"]);
  });

  it("does not re-ask the agent's own approval requirement", async () => {
    // The agent pauses on every call; this approval IS the answer to that
    // pause. Re-applying it would mean nothing could ever run.
    findAgentById.mockResolvedValue({
      ...agentWith([{ serverSlug: "crm", toolName: "delete_contact", enabled: true, requiresApproval: true }]),
      requiresApproval: true,
    });

    await approveMcpToolCall(CTX, CALL_ID);

    expect(runCall).toHaveBeenCalledTimes(1);
  });
});

describe("a decision happens once", () => {
  it("does not run the call when another reviewer got there first", async () => {
    // The row was still pending when we read it and gone by the time we
    // claimed it. The conditional update is what makes that safe.
    decideToolCall.mockResolvedValue(false);

    await expect(approveMcpToolCall(CTX, CALL_ID)).rejects.toBeInstanceOf(ApiError);
    expect(runCall).not.toHaveBeenCalled();
  });

  it("claims the row before running, not after", async () => {
    const order: string[] = [];
    decideToolCall.mockImplementation(async () => {
      order.push("claim");
      return true;
    });
    runCall.mockImplementation(async () => {
      order.push("run");
      return { callId: CALL_ID, status: "executed", resolution: "resolved", resultText: "ok", message: "ran", isError: false };
    });

    await approveMcpToolCall(CTX, CALL_ID);

    expect(order).toEqual(["claim", "run"]);
  });
});

describe("what actually gets sent", () => {
  it("uses the stored arguments, so a reviewer approves what they were shown", async () => {
    await approveMcpToolCall(CTX, CALL_ID);
    expect(runCall.mock.calls[0]?.[0]).toMatchObject({ args: { id: "contact-9" } });
  });

  it("tolerates a row whose arguments are not an object", async () => {
    findToolCallById.mockResolvedValue(pendingCall({ arguments: "corrupted" }));
    await approveMcpToolCall(CTX, CALL_ID);
    expect(runCall.mock.calls[0]?.[0]).toMatchObject({ args: {} });
  });
});
