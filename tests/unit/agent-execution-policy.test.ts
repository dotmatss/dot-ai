// @vitest-environment node
/**
 * How a tool policy and a workflow run id travel through an execution tree.
 *
 * `runRootAgent` is what a workflow step calls; `executeAgentTask` is what a
 * delegating agent calls for each child. The claim: a restriction placed on
 * the root is inherited unchanged by every child, however deep, and a child
 * cannot be handed more than its parent had. Alongside it, the run id that
 * started the root is stamped on every execution row in the tree.
 *
 * The engine and the repositories are mocked, so this observes the exact
 * options each collaborator receives rather than the end result.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELEGATION_DEFAULTS } from "@/features/agents/delegation-limits";
import type { Agent } from "@/features/agents/types";

const startAgentTurn = vi.hoisted(() => vi.fn());
const findAgentById = vi.hoisted(() => vi.fn());
const openAgentExecution = vi.hoisted(() => vi.fn());
const closeAgentExecution = vi.hoisted(() => vi.fn());

vi.mock("@/features/agents/server/agent-engine", () => ({ startAgentTurn, FULL_TOOL_POLICY: { mcp: true } }));
vi.mock("@/features/agents/server/agent-repository", () => ({ findAgentById }));
vi.mock("@/features/agents/server/agent-execution-repository", () => ({
  openAgentExecution,
  closeAgentExecution,
  attachExecutionConversation: async () => undefined,
}));

const { executeAgentTask, runRootAgent, createBudget } = await import("@/features/agents/server/agent-execution");

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "child-1",
    workspaceId: "ws-1",
    name: "Research Agent",
    description: null,
    status: "active",
    instructions: "Research things.",
    modelConfig: { model: null, temperature: 0.2, maxTokens: 512 },
    tools: [],
    mcpTools: [{ source: "mcp", serverSlug: "crm", toolName: "search", enabled: true, requiresApproval: false }],
    memoryConfig: { enabled: true, windowMessages: 10, summarize: false },
    outputSchema: null,
    requiresApproval: false,
    canDelegate: false,
    delegateIds: [],
    delegateCount: 0,
    delegationConfig: { ...DELEGATION_DEFAULTS },
    collectionIds: [],
    collectionCount: 0,
    enabledToolCount: 0,
    conversationCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A turn that answers immediately, so the adapter's own behaviour is what is measured. */
function stubTurn(text = "answer", events: AsyncIterable<unknown> = (async function* () {})()) {
  const finalize = vi.fn(async () => ({ conversationId: null, text, usage: { inputTokens: 5, outputTokens: 3 }, toolCalls: [], requiresApproval: false, sources: [] }));
  return { conversationId: null, events, finalize };
}

async function* streamThatDies() {
  yield { type: "text-delta", delta: "Refunds are available within 30 days unless" };
  yield { type: "error", message: "Stream failed" };
  yield { type: "done", finishReason: "error" };
}

async function* streamThatIsCancelled() {
  yield { type: "text-delta", delta: "Based on" };
  yield { type: "done", finishReason: "cancelled" };
}

async function* streamThatThrows() {
  yield { type: "text-delta", delta: "partial" };
  throw new Error("pool exhausted");
}

let executionCounter = 0;

beforeEach(() => {
  startAgentTurn.mockReset();
  findAgentById.mockReset();
  openAgentExecution.mockReset();
  closeAgentExecution.mockReset();
  executionCounter = 0;
  startAgentTurn.mockImplementation(async () => stubTurn());
  findAgentById.mockResolvedValue(agent());
  openAgentExecution.mockImplementation(async () => `exec-${++executionCounter}`);
  closeAgentExecution.mockResolvedValue(undefined);
});

function parentContext(overrides: Record<string, unknown> = {}) {
  return {
    executionId: "root-1",
    rootExecutionId: "root-1",
    parentExecutionId: null,
    agentPath: ["sup-1"],
    depth: 0,
    budget: createBudget({ ...DELEGATION_DEFAULTS }),
    conversationId: "conv-1",
    userId: "user-1",
    toolPolicy: { mcp: true },
    workflowRunId: null,
    ...overrides,
  };
}

describe("runRootAgent (what a workflow step calls)", () => {
  it("runs the agent under the policy it was given and stamps the run id on the execution", async () => {
    const result = await runRootAgent({
      workspaceId: "ws-1",
      agentId: "child-1",
      task: "Summarise the quarter.",
      userId: "user-1",
      signal: new AbortController().signal,
      toolPolicy: { mcp: false },
      workflowRunId: "run-9",
    });

    expect(result.status).toBe("succeeded");
    expect(result.output).toBe("answer");

    // The row: a root (depth 0, its own path), linked to the run, carrying the task.
    expect(openAgentExecution).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", agentId: "child-1", depth: 0, agentPath: ["child-1"], workflowRunId: "run-9", inputTask: "Summarise the quarter." }),
    );
    // The turn: detached, no conversation, and - the point - MCP off even
    // though the agent has an MCP tool attached.
    expect(startAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ transcript: "detached", conversationId: null, toolPolicy: { mcp: false } }));
    expect(closeAgentExecution).toHaveBeenCalledWith("ws-1", "exec-1", expect.objectContaining({ status: "succeeded", output: "answer", inputTokens: 5, outputTokens: 3 }));
  });

  it("reloads the agent through the workspace and refuses one it cannot find without opening a row", async () => {
    findAgentById.mockResolvedValue(null);
    const result = await runRootAgent({ workspaceId: "ws-1", agentId: "theirs", task: "x", userId: null, signal: new AbortController().signal, toolPolicy: { mcp: false }, workflowRunId: "run-1" });

    expect(findAgentById).toHaveBeenCalledWith("ws-1", "theirs");
    expect(result.status).toBe("refused");
    expect(result.output).toBeNull();
    expect(openAgentExecution).not.toHaveBeenCalled();
    expect(startAgentTurn).not.toHaveBeenCalled();
  });

  it("refuses an archived agent", async () => {
    findAgentById.mockResolvedValue(agent({ status: "archived" }));
    const result = await runRootAgent({ workspaceId: "ws-1", agentId: "child-1", task: "x", userId: null, signal: new AbortController().signal, toolPolicy: { mcp: false }, workflowRunId: null });
    expect(result.status).toBe("refused");
    expect(startAgentTurn).not.toHaveBeenCalled();
  });

  it("gives its delegation context the same restricted policy, so children inherit it", async () => {
    const seen: Array<{ mcp: boolean }> = [];
    await runRootAgent({
      workspaceId: "ws-1",
      agentId: "child-1",
      task: "x",
      userId: null,
      signal: new AbortController().signal,
      toolPolicy: { mcp: false },
      workflowRunId: "run-1",
      delegationFor: async ({ execution }) => {
        seen.push(execution.toolPolicy);
        return undefined;
      },
    });
    expect(seen).toEqual([{ mcp: false }]);
  });

  it("does not report a stream that died mid-answer as success", async () => {
    // The text so far reads like an answer. It is not one, and the next
    // workflow step must not be handed it as if the agent had finished.
    startAgentTurn.mockImplementation(async () => stubTurn("Refunds are available within 30 days unless", streamThatDies()));
    const result = await runRootAgent({ workspaceId: "ws-1", agentId: "child-1", task: "Summarise the refund policy.", userId: null, signal: new AbortController().signal, toolPolicy: { mcp: false }, workflowRunId: "run-1" });

    expect(result.status).toBe("failed");
    expect(result.output).toBeNull();
    expect(result.error).toContain("cut off");
    expect(closeAgentExecution).toHaveBeenCalledWith("ws-1", "exec-1", expect.objectContaining({ status: "failed" }));
  });

  it("treats a cancelled stream as a failure, not an answer", async () => {
    startAgentTurn.mockImplementation(async () => stubTurn("Based on", streamThatIsCancelled()));
    const result = await runRootAgent({ workspaceId: "ws-1", agentId: "child-1", task: "x", userId: null, signal: new AbortController().signal, toolPolicy: { mcp: false }, workflowRunId: null });
    expect(result.status).toBe("failed");
    expect(result.output).toBeNull();
  });

  it("still finalizes - and charges the budget - when the turn throws part-way", async () => {
    const turn = stubTurn("partial", streamThatThrows());
    startAgentTurn.mockImplementation(async () => turn);
    const parent = parentContext();
    const before = parent.budget.remainingTokens;

    const result = await executeAgentTask({ workspaceId: "ws-1", childAgentId: "child-1", task: "x", context: null, parent, signal: new AbortController().signal });

    // Metered exactly once, like the streaming adapter's `finally` guarantees...
    expect(turn.finalize).toHaveBeenCalledTimes(1);
    // ...charged to the shared budget even though the turn blew up...
    expect(parent.budget.remainingTokens).toBe(before - 8);
    // ...and reported as a failure, in outline.
    expect(result.status).toBe("failed");
    expect(result.output).toBeNull();
    expect(JSON.stringify(result)).not.toContain("pool exhausted");
    expect(closeAgentExecution).toHaveBeenCalledWith("ws-1", "exec-1", expect.objectContaining({ status: "failed" }));
  });

  it("reports an engine failure in outline and closes the row", async () => {
    startAgentTurn.mockRejectedValue(new Error("provider exploded at https://internal.example/secret"));
    const result = await runRootAgent({ workspaceId: "ws-1", agentId: "child-1", task: "x", userId: null, signal: new AbortController().signal, toolPolicy: { mcp: false }, workflowRunId: null });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("The agent could not complete the task.");
    expect(JSON.stringify(result)).not.toContain("internal.example");
    expect(closeAgentExecution).toHaveBeenCalledWith("ws-1", "exec-1", expect.objectContaining({ status: "failed" }));
  });
});

describe("executeAgentTask (what a delegating agent calls)", () => {
  it("passes the parent's policy to the child, not the child's own configuration", async () => {
    await executeAgentTask({
      workspaceId: "ws-1",
      childAgentId: "child-1",
      task: "Look this up.",
      context: null,
      parent: parentContext({ toolPolicy: { mcp: false } }),
      signal: new AbortController().signal,
    });
    expect(startAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ toolPolicy: { mcp: false }, transcript: "detached" }));
  });

  it("propagates the workflow run id and the parent's conversation to the child's row", async () => {
    await executeAgentTask({
      workspaceId: "ws-1",
      childAgentId: "child-1",
      task: "x",
      context: null,
      parent: parentContext({ workflowRunId: "run-7", conversationId: null, toolPolicy: { mcp: false } }),
      signal: new AbortController().signal,
    });
    expect(openAgentExecution).toHaveBeenCalledWith(
      expect.objectContaining({ workflowRunId: "run-7", parentExecutionId: "root-1", rootExecutionId: "root-1", depth: 1, agentPath: ["sup-1", "child-1"] }),
    );
  });

  it("hands a grandchild the same policy through delegationFor", async () => {
    const seen: Array<{ mcp: boolean }> = [];
    await executeAgentTask({
      workspaceId: "ws-1",
      childAgentId: "child-1",
      task: "x",
      context: null,
      parent: parentContext({ toolPolicy: { mcp: false } }),
      signal: new AbortController().signal,
      delegationFor: async ({ execution }) => {
        seen.push(execution.toolPolicy);
        return undefined;
      },
    });
    expect(seen).toEqual([{ mcp: false }]);
  });

  it("refuses a child that no longer exists without opening a row, so the turn is not aborted by a foreign key", async () => {
    // The grant was loaded at the start of the turn; the target was deleted
    // while the model was deciding. A row referencing it cannot be inserted.
    findAgentById.mockResolvedValue(null);
    const result = await executeAgentTask({
      workspaceId: "ws-1",
      childAgentId: "gone",
      task: "x",
      context: null,
      parent: parentContext(),
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("refused");
    expect(result.output).toBeNull();
    expect(openAgentExecution).not.toHaveBeenCalled();
    expect(startAgentTurn).not.toHaveBeenCalled();
  });

  it("refuses an archived child the same way", async () => {
    findAgentById.mockResolvedValue(agent({ status: "archived" }));
    const result = await executeAgentTask({ workspaceId: "ws-1", childAgentId: "child-1", task: "x", context: null, parent: parentContext(), signal: new AbortController().signal });
    expect(result.status).toBe("refused");
    expect(openAgentExecution).not.toHaveBeenCalled();
  });

  it("keeps the full policy when the parent had it - existing delegation is unchanged", async () => {
    await executeAgentTask({ workspaceId: "ws-1", childAgentId: "child-1", task: "x", context: null, parent: parentContext(), signal: new AbortController().signal });
    expect(startAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ toolPolicy: { mcp: true } }));
  });
});
