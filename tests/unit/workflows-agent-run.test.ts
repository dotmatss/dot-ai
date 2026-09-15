/**
 * The `agent.run` step, in the pure workflow engine.
 *
 * The engine never runs an agent itself: it calls an injected `runAgent`, the
 * way it calls an injected gateway. These tests drive that seam with a stub
 * and assert the contract around it:
 *
 *   - an answer flows into `{{vars.<outputKey>}}` and on to the next step, so
 *     sequential pipelines and handoffs are just ordinary edges
 *   - a definition with an agent step refuses to start when no runner was
 *     provided - before its first step, not at the agent step
 *   - the agent's tokens are NOT added to the run's usage (they are metered
 *     once, by the agent engine)
 *   - a failed, refused or timed-out agent fails the step and writes nothing
 *   - existing definitions without an agent step neither need nor notice a runner
 *
 * The workflow gateway throws if touched: an agent step must reach the agent
 * engine through the runner and never the workflow's own model call.
 */
import { describe, expect, it, vi } from "vitest";

import { MAX_AGENT_STEPS, validateDefinition, type WorkflowDefinition } from "@/features/workflows/domain/definition";
import {
  executeDefinition,
  type WorkflowAgentResult,
  type WorkflowAgentRunner,
  type WorkflowAiGateway,
} from "@/features/workflows/domain/execution";

const untouchedGateway: WorkflowAiGateway = {
  provider: "stub",
  async *streamChat() {
    throw new Error("the workflow gateway must not be used by an agent step");
  },
};

const neverFetch = (() => {
  throw new Error("fetch must not be called");
}) as unknown as typeof fetch;

const RESEARCH = "11111111-1111-4111-8111-111111111111";
const WRITER = "22222222-2222-4222-8222-222222222222";
const BILLING = "33333333-3333-4333-8333-333333333333";
const SUPPORT = "44444444-4444-4444-8444-444444444444";

function ok(output: string, overrides: Partial<WorkflowAgentResult> = {}): WorkflowAgentResult {
  return {
    executionId: `exec-${output.slice(0, 6)}`,
    status: "succeeded",
    output,
    error: null,
    usage: { inputTokens: 100, outputTokens: 40 },
    requiresApproval: false,
    ...overrides,
  };
}

/** Records every call and answers per agent id. */
function stubRunner(answers: Record<string, WorkflowAgentResult | ((task: string) => WorkflowAgentResult)>) {
  const calls: Array<{ agentId: string; task: string; signal?: AbortSignal }> = [];
  const runAgent: WorkflowAgentRunner = vi.fn(async (input) => {
    calls.push(input);
    const answer = answers[input.agentId];
    if (!answer) {
      return { executionId: "", status: "refused" as const, output: null, error: "That agent is not available in this workspace.", usage: null, requiresApproval: false };
    }
    return typeof answer === "function" ? answer(input.task) : answer;
  });
  return { runAgent, calls };
}

const trigger = { id: "start", type: "trigger.manual" as const, label: "Start", config: { note: "" } };
const respond = (message: string) => ({ id: "respond", type: "output.respond" as const, label: "Respond", config: { message, outputKey: "message" } });
const agentStep = (id: string, agentId: string, task: string, outputKey: string) => ({
  id,
  type: "agent.run" as const,
  label: id,
  config: { agentId, task, outputKey },
});
const edge = (from: string, to: string, condition?: "true" | "false") => ({ id: `${from}-${to}`, from, to, ...(condition ? { condition } : {}) });

/** Start → Research agent → Writer agent → Respond, each step reading the last. */
function pipeline(): WorkflowDefinition {
  return {
    nodes: [
      trigger,
      agentStep("research", RESEARCH, "Research this: {{trigger.message}}", "research"),
      agentStep("write", WRITER, "Write it up from these notes: {{vars.research}}", "draft"),
      respond("{{vars.draft}}"),
    ],
    edges: [edge("start", "research"), edge("research", "write"), edge("write", "respond")],
  };
}

describe("agent.run — sequential pipeline", () => {
  it("passes each agent's answer to the next step and to the run output", async () => {
    const { runAgent, calls } = stubRunner({
      [RESEARCH]: ok("Three competitors raised prices in Q3."),
      [WRITER]: (task) => ok(`Summary based on: ${task}`),
    });

    const result = await executeDefinition({
      definition: pipeline(),
      gateway: untouchedGateway,
      trigger: { message: "What changed in the market?" },
      fetchImpl: neverFetch,
      runAgent,
    });

    expect(result.status).toBe("succeeded");
    expect(result.steps.map((step) => step.nodeId)).toEqual(["start", "research", "write", "respond"]);

    // The first task was rendered from the trigger; the second from the first
    // agent's answer. That is the whole of "handoff": an ordinary template.
    expect(calls[0]).toMatchObject({ agentId: RESEARCH, task: "Research this: What changed in the market?" });
    expect(calls[1]?.task).toBe("Write it up from these notes: Three competitors raised prices in Q3.");

    expect(result.context.vars).toMatchObject({ research: "Three competitors raised prices in Q3." });
    expect(result.output?.message).toContain("Summary based on: Write it up from these notes:");
  });

  it("keeps the agent's tokens out of the run's own usage", async () => {
    const { runAgent } = stubRunner({ [RESEARCH]: ok("a"), [WRITER]: ok("b") });
    const result = await executeDefinition({ definition: pipeline(), gateway: untouchedGateway, trigger: {}, fetchImpl: neverFetch, runAgent });

    // Two agents each reported 140 tokens. None of it lands here: the agent
    // engine metered it already, against the agent that spent it, and adding
    // it again would bill it twice.
    expect(result.usage).toEqual({ aiCalls: 0, inputTokens: 0, outputTokens: 0 });
    // ...but the timeline still shows what each step cost.
    expect(result.steps[1]?.output).toMatchObject({ usage: { inputTokens: 100, outputTokens: 40 }, status: "succeeded" });
  });

  it("records only the answer and safe metadata in the step, never the agent's internals", async () => {
    const { runAgent } = stubRunner({ [RESEARCH]: ok("answer"), [WRITER]: ok("draft") });
    const result = await executeDefinition({ definition: pipeline(), gateway: untouchedGateway, trigger: {}, fetchImpl: neverFetch, runAgent });

    const step = result.steps[1]?.output ?? {};
    expect(Object.keys(step).sort()).toEqual(["answer", "executionId", "missingVariables", "requiresApproval", "status", "usage"]);
  });

  it("hands the run's abort signal to the runner", async () => {
    const controller = new AbortController();
    const { runAgent, calls } = stubRunner({ [RESEARCH]: ok("a"), [WRITER]: ok("b") });
    await executeDefinition({ definition: pipeline(), gateway: untouchedGateway, trigger: {}, fetchImpl: neverFetch, runAgent, signal: controller.signal });
    expect(calls[0]?.signal).toBe(controller.signal);
  });
});

describe("agent.run — handoff through a branch", () => {
  /** Start → Triage agent → branch on its answer → Billing or Support agent → Respond. */
  function router(): WorkflowDefinition {
    return {
      nodes: [
        trigger,
        agentStep("triage", RESEARCH, "Classify: {{trigger.message}}. Answer billing or support.", "route"),
        { id: "branch", type: "condition.branch", label: "Route", config: { left: "{{vars.route}}", operator: "equals", right: "billing", caseSensitive: false } },
        agentStep("billing", BILLING, "Handle the billing question: {{trigger.message}}", "answer"),
        agentStep("support", SUPPORT, "Handle the support question: {{trigger.message}}", "answer"),
        respond("{{vars.answer}}"),
      ],
      edges: [
        edge("start", "triage"),
        edge("triage", "branch"),
        edge("branch", "billing", "true"),
        edge("branch", "support", "false"),
        edge("billing", "respond"),
        edge("support", "respond"),
      ],
    };
  }

  it("routes to the agent the first agent's answer selects", async () => {
    const { runAgent, calls } = stubRunner({
      [RESEARCH]: ok("billing"),
      [BILLING]: ok("Your invoice was reissued."),
      [SUPPORT]: ok("should not run"),
    });
    const result = await executeDefinition({ definition: router(), gateway: untouchedGateway, trigger: { message: "Why was I charged twice?" }, fetchImpl: neverFetch, runAgent });

    expect(result.status).toBe("succeeded");
    expect(result.steps.map((step) => step.nodeId)).toEqual(["start", "triage", "branch", "billing", "respond"]);
    expect(calls.map((call) => call.agentId)).toEqual([RESEARCH, BILLING]);
    expect(result.output?.message).toBe("Your invoice was reissued.");
  });

  it("takes the other branch when the answer does not match", async () => {
    const { runAgent, calls } = stubRunner({ [RESEARCH]: ok("support"), [BILLING]: ok("no"), [SUPPORT]: ok("Try signing out and back in.") });
    const result = await executeDefinition({ definition: router(), gateway: untouchedGateway, trigger: { message: "The app crashes" }, fetchImpl: neverFetch, runAgent });

    expect(result.steps.map((step) => step.nodeId)).toEqual(["start", "triage", "branch", "support", "respond"]);
    expect(calls.map((call) => call.agentId)).toEqual([RESEARCH, SUPPORT]);
  });
});

describe("agent.run — refusing to run", () => {
  it("fails before the first step when the definition has an agent step and no runner", async () => {
    const result = await executeDefinition({ definition: pipeline(), gateway: untouchedGateway, trigger: {}, fetchImpl: neverFetch });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("not available in this context");
    // Nothing ran. An earlier action step could have had side effects, and a
    // run that cannot finish should not start them.
    expect(result.steps).toEqual([]);
  });

  it("does not require a runner for a definition with no agent step", async () => {
    const plain: WorkflowDefinition = { nodes: [trigger, respond("Hello {{trigger.name}}")], edges: [edge("start", "respond")] };
    const result = await executeDefinition({ definition: plain, gateway: untouchedGateway, trigger: { name: "Ada" }, fetchImpl: neverFetch });
    expect(result.status).toBe("succeeded");
    expect(result.output).toEqual({ message: "Hello Ada" });
  });

  it("refuses to start when a step has no agent chosen, and the builder is told the same", async () => {
    const { runAgent } = stubRunner({});
    const definition: WorkflowDefinition = {
      nodes: [trigger, agentStep("agent", "", "Do it", "answer"), respond("{{vars.answer}}")],
      edges: [edge("start", "agent"), edge("agent", "respond")],
    };

    // The validator flags it as a blocking issue on the field, so the builder
    // shows it and activation is refused...
    const issues = validateDefinition(definition).filter((issue) => issue.code === "invalid_config");
    expect(issues).toEqual([expect.objectContaining({ severity: "error", nodeId: "agent", field: "agentId" })]);
    expect(issues[0]?.message).toContain("Choose an agent");

    // ...and a run refuses before its first step rather than failing at the
    // agent after earlier steps have already acted.
    const result = await executeDefinition({ definition, gateway: untouchedGateway, trigger: {}, fetchImpl: neverFetch, runAgent });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Choose an agent");
    expect(result.steps).toEqual([]);
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("accepts a step once an agent is chosen", () => {
    expect(validateDefinition(pipeline()).filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("caps the number of agent steps in one workflow", () => {
    // Every agent step is a full agent turn inside one request, sharing one
    // wall clock. Past a handful the later steps could only ever time out.
    const ids = Array.from({ length: MAX_AGENT_STEPS + 1 }, (_, i) => `a${i}`);
    const definition: WorkflowDefinition = {
      nodes: [trigger, ...ids.map((id) => agentStep(id, RESEARCH, "Step {{trigger.message}}", `out_${id}`)), respond("done")],
      edges: [edge("start", ids[0]!), ...ids.slice(1).map((id, i) => edge(ids[i]!, id)), edge(ids[ids.length - 1]!, "respond")],
    };
    const issues = validateDefinition(definition).filter((issue) => issue.code === "too_many_agent_steps");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("error");

    // Exactly the cap is fine.
    const atCap: WorkflowDefinition = {
      nodes: [trigger, ...ids.slice(0, MAX_AGENT_STEPS).map((id) => agentStep(id, RESEARCH, "Step", `out_${id}`)), respond("done")],
      edges: [edge("start", ids[0]!), ...ids.slice(1, MAX_AGENT_STEPS).map((id, i) => edge(ids[i]!, id)), edge(ids[MAX_AGENT_STEPS - 1]!, "respond")],
    };
    expect(validateDefinition(atCap).filter((issue) => issue.code === "too_many_agent_steps")).toEqual([]);
  });

  it.each([
    ["refused", "That agent is not available in this workspace."],
    ["failed", "The agent could not complete the task."],
    ["timed_out", "The agent ran out of time."],
  ] as const)("fails the step with the runner's own error when the agent is %s", async (status, error) => {
    const { runAgent } = stubRunner({ [RESEARCH]: { executionId: "exec-1", status, output: null, error, usage: null, requiresApproval: false }, [WRITER]: ok("never") });
    const result = await executeDefinition({ definition: pipeline(), gateway: untouchedGateway, trigger: {}, fetchImpl: neverFetch, runAgent });

    expect(result.status).toBe("failed");
    expect(result.error).toBe(error);
    expect(result.steps.map((step) => step.nodeId)).toEqual(["start", "research"]);
    expect(result.steps[1]?.status).toBe("failed");
    // The failed step still tells the timeline which execution to look at.
    expect(result.steps[1]?.output).toMatchObject({ executionId: "exec-1", status });
    // And wrote nothing downstream could mistake for an answer.
    expect(result.context.vars.research).toBeUndefined();
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("treats a success with no answer as a failure", async () => {
    const { runAgent } = stubRunner({ [RESEARCH]: ok("x", { output: null }), [WRITER]: ok("never") });
    const result = await executeDefinition({ definition: pipeline(), gateway: untouchedGateway, trigger: {}, fetchImpl: neverFetch, runAgent });
    expect(result.status).toBe("failed");
    expect(result.steps).toHaveLength(2);
  });
});

describe("agent.run — approval", () => {
  it("continues with the answer and surfaces that a person still has to approve something", async () => {
    const { runAgent } = stubRunner({
      [RESEARCH]: ok("I drafted the refund; it needs sign-off before it goes out.", { requiresApproval: true }),
      [WRITER]: ok("done"),
    });
    const result = await executeDefinition({ definition: pipeline(), gateway: untouchedGateway, trigger: {}, fetchImpl: neverFetch, runAgent });

    expect(result.status).toBe("succeeded");
    expect(result.steps[1]?.output).toMatchObject({ requiresApproval: true });
  });
});
