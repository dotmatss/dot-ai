// @vitest-environment node
/**
 * What a supervisor is allowed to do, and what it is not.
 *
 * The model chooses *whether* to delegate, *which* of the agents it was shown
 * and *what* to ask. Everything else is decided here, from server state, on
 * every single call. These tests are mostly refusals, because every refusal is
 * a rule somebody is relying on:
 *
 *   - an agent without the capability is never even offered the tool
 *   - only explicitly granted, enabled, non-archived agents can be named
 *   - a cycle is refused at the point it would be walked
 *   - depth, delegation count, token budget and the deadline are all checked
 *     before a child starts, and none of them is stated to the model
 *   - the model never sees or supplies a database id
 *
 * The repository and the executor are mocked, so this runs without a database
 * and asserts the decision rather than the plumbing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELEGATION_DEFAULTS } from "@/features/agents/delegation-limits";
import type { Agent, DelegationTarget } from "@/features/agents/types";

const listDelegationTargets = vi.hoisted(() => vi.fn());
const executeAgentTask = vi.hoisted(() => vi.fn());

vi.mock("@/features/agents/server/agent-repository", () => ({ listDelegationTargets }));
vi.mock("@/features/agents/server/agent-execution", () => ({ executeAgentTask }));

const { loadDelegationContext } = await import("@/features/agents/server/delegation");
const { DELEGATION_TOOL_NAME } = await import("@/features/agents/server/agent-engine");

const WORKSPACE = "ws-1";
const SUPERVISOR = "sup-1";
const RESEARCH = "res-1";

function supervisor(overrides: Partial<Agent> = {}): Agent {
  return {
    id: SUPERVISOR,
    workspaceId: WORKSPACE,
    name: "Operations Supervisor",
    description: null,
    status: "active",
    instructions: "Coordinate the specialists.",
    modelConfig: { model: null, temperature: 0.2, maxTokens: 2048 },
    tools: [],
    mcpTools: [],
    memoryConfig: { enabled: true, windowMessages: 20, summarize: false },
    outputSchema: null,
    requiresApproval: false,
    canDelegate: true,
    delegateIds: [RESEARCH],
    delegateCount: 1,
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

function target(overrides: Partial<DelegationTarget> = {}): DelegationTarget {
  return { id: RESEARCH, name: "Research Agent", description: null, status: "active", enabled: true, canDelegate: false, ...overrides };
}

function execution(overrides: Partial<Parameters<typeof loadDelegationContext>[0]["execution"]> = {}) {
  return {
    executionId: "exec-1",
    rootExecutionId: "exec-1",
    parentExecutionId: null,
    agentPath: [SUPERVISOR],
    depth: 0,
    conversationId: "conv-1",
    userId: "user-1",
    toolPolicy: { mcp: true },
    workflowRunId: null,
    budget: {
      deadline: Date.now() + 60_000,
      remainingDelegations: 3,
      remainingTokens: 100_000,
      maxDepth: 2,
    },
    ...overrides,
  };
}

function load(options: { agent?: Agent; execution?: ReturnType<typeof execution> } = {}) {
  return loadDelegationContext({
    workspaceId: WORKSPACE,
    agent: options.agent ?? supervisor(),
    execution: options.execution ?? execution(),
    userId: "user-1",
  });
}

beforeEach(() => {
  listDelegationTargets.mockReset();
  executeAgentTask.mockReset();
  listDelegationTargets.mockResolvedValue([target()]);
  executeAgentTask.mockResolvedValue({
    executionId: "exec-2",
    status: "succeeded",
    output: "Three competitors raised prices.",
    error: null,
    usage: { inputTokens: 100, outputTokens: 50 },
    requiresApproval: false,
  });
});

describe("who is offered the delegation tool at all", () => {
  it("is not offered to an agent without the capability", async () => {
    // Not merely refused if it asks - never told the option exists.
    await expect(load({ agent: supervisor({ canDelegate: false }) })).resolves.toBeUndefined();
    expect(listDelegationTargets).not.toHaveBeenCalled();
  });

  it("is not offered to a supervisor with no grants", async () => {
    listDelegationTargets.mockResolvedValue([]);
    await expect(load()).resolves.toBeUndefined();
  });

  it("is not offered when every grant is disabled or archived", async () => {
    listDelegationTargets.mockResolvedValue([target({ enabled: false }), target({ id: "x", name: "Old", status: "archived" })]);
    await expect(load()).resolves.toBeUndefined();
  });

  it("is not offered to an agent already at maximum depth", async () => {
    const context = await load({ execution: execution({ depth: 2, budget: { ...execution().budget, maxDepth: 2 } }) });
    expect(context).toBeUndefined();
  });
});

describe("the tool the model is shown", () => {
  it("enumerates the granted agents by name and never exposes an id", async () => {
    listDelegationTargets.mockResolvedValue([target(), target({ id: "sal-1", name: "Sales Agent" })]);
    const context = await load();
    const definition = context?.definitions[0];

    expect(definition?.name).toBe(DELEGATION_TOOL_NAME);
    const properties = definition?.parameters.properties as Record<string, { enum?: string[] }>;
    expect(properties.agent?.enum).toEqual(["Research Agent", "Sales Agent"]);

    // The whole declaration, serialised: no database id anywhere in it.
    const serialised = JSON.stringify(definition);
    expect(serialised).not.toContain(RESEARCH);
    expect(serialised).not.toContain("sal-1");
  });

  it("omits a disabled or archived grant from the list", async () => {
    listDelegationTargets.mockResolvedValue([
      target(),
      target({ id: "fin-1", name: "Finance Agent", enabled: false }),
      target({ id: "old-1", name: "Retired Agent", status: "archived" }),
    ]);
    const context = await load();
    const properties = context?.definitions[0]?.parameters.properties as Record<string, { enum?: string[] }>;
    expect(properties.agent?.enum).toEqual(["Research Agent"]);
  });
});

describe("authorization, re-decided on every call", () => {
  it("runs an authorized delegation and returns only the child's answer", async () => {
    const context = await load();
    const plan = context!.prepare({ agent: "Research Agent", task: "Check competitor pricing" });
    expect(plan.ok).toBe(true);

    const outcome = await context!.run(plan as never, new AbortController().signal);
    expect(outcome.status).toBe("executed");
    expect(outcome.resultText).toBe("Three competitors raised prices.");

    // The child was named by id we resolved ourselves, in our workspace.
    expect(executeAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE, childAgentId: RESEARCH, task: "Check competitor pricing" }),
    );
  });

  it("refuses an agent that was never granted, in the same words as one that does not exist", async () => {
    const context = await load();
    const invented = context!.prepare({ agent: "Finance Agent", task: "Pay the invoice" });
    const nonsense = context!.prepare({ agent: "Not An Agent At All", task: "Do something" });

    expect(invented.ok).toBe(false);
    expect(nonsense.ok).toBe(false);

    // The only thing that differs is the name the model itself supplied, which
    // tells it nothing it did not already know. "Exists but you were not
    // granted it", "belongs to another workspace" and "does not exist" are one
    // answer on purpose: distinguishing them would confirm that an agent with
    // that name exists somewhere.
    const template = (plan: typeof invented, name: string) => (plan.ok === false ? plan.reason.replace(name, "«name»") : "");
    expect(template(invented, "Finance Agent")).toBe(template(nonsense, "Not An Agent At All"));
    expect(invented.ok === false && invented.status).toBe(nonsense.ok === false && nonsense.status);
    expect(executeAgentTask).not.toHaveBeenCalled();
  });

  it("rejects malformed arguments rather than guessing", async () => {
    const context = await load();
    expect(context!.prepare({ task: "no agent named" }).ok).toBe(false);
    expect(context!.prepare({ agent: "Research Agent" }).ok).toBe(false);
    expect(context!.prepare("not an object").ok).toBe(false);
    expect(context!.prepare(null).ok).toBe(false);
  });
});

describe("recursion protection", () => {
  it("refuses an agent already on the path", async () => {
    // A → B → A. The grant graph may contain a loop; walking one must not happen.
    const context = await load({ execution: execution({ agentPath: [SUPERVISOR, "mid-1", RESEARCH], depth: 2, budget: { ...execution().budget, maxDepth: 3 } }) });
    const plan = context!.prepare({ agent: "Research Agent", task: "Loop" });
    expect(plan.ok).toBe(false);
    expect(executeAgentTask).not.toHaveBeenCalled();
  });

  it("refuses a supervisor that reaches back to itself", async () => {
    listDelegationTargets.mockResolvedValue([target({ id: SUPERVISOR, name: "Operations Supervisor" })]);
    const context = await load();
    const plan = context!.prepare({ agent: "Operations Supervisor", task: "Recurse" });
    expect(plan.ok).toBe(false);
  });

  it("refuses once the next step would exceed the depth limit", async () => {
    const budget = { ...execution().budget, maxDepth: 2 };
    const context = await load({ execution: execution({ depth: 1, budget }) });
    // depth 1 → child at 2 is allowed; the context exists.
    expect(context).toBeDefined();

    const deeper = await load({ execution: execution({ depth: 2, budget }) });
    expect(deeper).toBeUndefined();
  });
});

describe("resource limits", () => {
  it("refuses when the delegation count is spent", async () => {
    const context = await load({ execution: execution({ budget: { ...execution().budget, remainingDelegations: 0 } }) });
    expect(context!.prepare({ agent: "Research Agent", task: "One more" }).ok).toBe(false);
  });

  it("refuses when the token budget is spent", async () => {
    const context = await load({ execution: execution({ budget: { ...execution().budget, remainingTokens: 0 } }) });
    expect(context!.prepare({ agent: "Research Agent", task: "One more" }).ok).toBe(false);
  });

  it("refuses when the deadline has passed", async () => {
    const context = await load({ execution: execution({ budget: { ...execution().budget, deadline: Date.now() - 1 } }) });
    expect(context!.prepare({ agent: "Research Agent", task: "Too late" }).ok).toBe(false);
  });

  it("claims a delegation before the child starts, so the budget cannot be double spent", async () => {
    const context_ = execution();
    const context = await load({ execution: context_ });
    const plan = context!.prepare({ agent: "Research Agent", task: "Work" });

    await context!.run(plan as never, new AbortController().signal);
    expect(context_.budget.remainingDelegations).toBe(2);

    // And the budget is shared, so the third refuses the fourth.
    await context!.run(plan as never, new AbortController().signal);
    await context!.run(plan as never, new AbortController().signal);
    expect(context_.budget.remainingDelegations).toBe(0);
    expect(context!.prepare({ agent: "Research Agent", task: "Fourth" }).ok).toBe(false);
  });
});

describe("failure handling", () => {
  it("reports a failed child as a fact, and feeds no result back", async () => {
    executeAgentTask.mockResolvedValue({
      executionId: "exec-2",
      status: "failed",
      output: null,
      error: "boom",
      usage: null,
      requiresApproval: false,
    });
    const context = await load();
    const plan = context!.prepare({ agent: "Research Agent", task: "Work" });
    const outcome = await context!.run(plan as never, new AbortController().signal);

    expect(outcome.resultText).toBeNull();
    expect(outcome.status).toBe("unavailable");
    // The child's internal error is not handed to the supervisor's model.
    expect(outcome.message).not.toContain("boom");
  });

  it("does not retry a failed child", async () => {
    executeAgentTask.mockResolvedValue({ executionId: "e", status: "timed_out", output: null, error: null, usage: null, requiresApproval: false });
    const context = await load();
    const plan = context!.prepare({ agent: "Research Agent", task: "Work" });
    await context!.run(plan as never, new AbortController().signal);

    // A retry is another full agent turn, and nothing here knows whether the
    // task had side effects.
    expect(executeAgentTask).toHaveBeenCalledTimes(1);
  });

  it("passes an approval-required child through without pretending it finished", async () => {
    executeAgentTask.mockResolvedValue({
      executionId: "exec-2",
      status: "succeeded",
      output: "I prepared the invoice but it needs sign-off.",
      error: null,
      usage: null,
      requiresApproval: true,
    });
    const context = await load();
    const plan = context!.prepare({ agent: "Research Agent", task: "Invoice" });
    const outcome = await context!.run(plan as never, new AbortController().signal);

    expect(outcome.requiresApproval).toBe(true);
    expect(outcome.message).toContain("approve");
  });
});
