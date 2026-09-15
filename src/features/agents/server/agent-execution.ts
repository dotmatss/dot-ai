import "server-only";

import type { DelegationConfig } from "@/features/agents/delegation-limits";
import { findAgentById } from "@/features/agents/server/agent-repository";
import {
  startAgentTurn,
  type AgentDelegationContext,
  type AgentToolPolicy,
  type AgentTurn,
  type AgentTurnOutcome,
} from "@/features/agents/server/agent-engine";
import { closeAgentExecution, openAgentExecution } from "@/features/agents/server/agent-execution-repository";
import type { AgentExecutionResult, AgentExecutionStatus } from "@/features/agents/types";

/**
 * The collect-to-value adapter over the agent engine.
 *
 * A supervisor cannot consume an SSE `Response`; it needs an answer. This runs
 * exactly the same engine the streaming adapter runs, drains its events, and
 * returns a deliberately narrow result.
 *
 * WHAT COMES BACK, AND WHAT DOES NOT
 * ----------------------------------
 * Only the child's final answer, a status, its usage and whether something is
 * waiting on a person. Not its system prompt, not its tool calls, not its
 * retrieved passages, not its MCP arguments or results, not its configuration,
 * not any identifier belonging to a server or credential it used. The
 * supervisor is asking a colleague a question, not being handed their desk.
 */

/** Shared down the whole tree and mutated as it is spent. */
export interface ExecutionBudget {
  /** Absolute wall-clock deadline for the entire tree, as epoch milliseconds. */
  deadline: number;
  /** Child executions still permitted across this root request. */
  remainingDelegations: number;
  /** Combined tokens still permitted across this root request. */
  remainingTokens: number;
  maxDepth: number;
}

export interface AgentExecutionContext {
  executionId: string;
  rootExecutionId: string;
  parentExecutionId: string | null;
  /** Root to here, inclusive. Cycle detection is a membership test on this. */
  agentPath: string[];
  depth: number;
  /** The one object every agent in the tree shares. */
  budget: ExecutionBudget;
  conversationId: string | null;
  userId: string | null;
  /**
   * Inherited unchanged by every child. A restriction placed on the root - a
   * workflow forbidding MCP - therefore holds for anything the root delegates
   * to, however deep; a child cannot be granted more than its parent had.
   */
  toolPolicy: AgentToolPolicy;
  /** The workflow run that started the root, propagated so the tree is findable from the run. */
  workflowRunId: string | null;
}

export function createBudget(config: DelegationConfig, now = Date.now()): ExecutionBudget {
  return {
    deadline: now + config.timeoutMs,
    remainingDelegations: config.maxDelegations,
    remainingTokens: config.tokenBudget,
    maxDepth: config.maxDepth,
  };
}

/**
 * Aborts when either the caller aborts or the tree's deadline passes.
 *
 * The deadline is absolute and shared, so a child started late gets only the
 * time that is actually left rather than a fresh allowance - which is what
 * stops three sequential children from taking three times the budget.
 */
function deadlineSignal(parent: AbortSignal, deadline: number): { signal: AbortSignal; cancel: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;
  const remaining = Math.max(0, deadline - Date.now());

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, remaining);

  const onParentAbort = () => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener("abort", onParentAbort, { once: true });

  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
    timedOut: () => timedOut,
  };
}

export interface ExecuteAgentTaskOptions {
  workspaceId: string;
  childAgentId: string;
  task: string;
  context: string | null;
  parent: AgentExecutionContext;
  signal: AbortSignal;
  /**
   * Builds the child's own delegation context when the child may itself
   * delegate. Injected so this module does not import `delegation.ts`, which
   * imports this one.
   */
  delegationFor?: (input: {
    agent: Awaited<ReturnType<typeof findAgentById>>;
    execution: AgentExecutionContext;
  }) => Promise<AgentDelegationContext | undefined>;
}

/**
 * Runs one child agent to completion and returns its answer.
 *
 * The child is reloaded from the database by `(workspaceId, childAgentId)` and
 * everything it uses - instructions, model, collections, tools, MCP grants and
 * approval policy - is resolved from that row. Nothing about the supervisor's
 * configuration or authority reaches it.
 */
export async function executeAgentTask(options: ExecuteAgentTaskOptions): Promise<AgentExecutionResult> {
  const { workspaceId, childAgentId, parent } = options;

  // Reloaded here, scoped to the workspace. The caller passes an id; the id is
  // never enough on its own.
  const child = await findAgentById(workspaceId, childAgentId);

  // Refused BEFORE a row is opened, like `runRootAgent`. The grant was loaded
  // at the start of the turn and the model may take many seconds to decide;
  // if the target was deleted in between, inserting a row that references it
  // would fail on the foreign key and turn a clean refusal into an error that
  // aborts the supervisor's whole turn.
  const refused = (error: string): AgentExecutionResult => ({
    executionId: "",
    status: "refused",
    output: null,
    error,
    usage: null,
    requiresApproval: false,
  });
  if (!child) return refused("That agent is no longer available.");
  if (child.status === "archived") return refused("That agent is archived and cannot run.");

  const agentPath = [...parent.agentPath, childAgentId];
  const executionId = await openAgentExecution({
    workspaceId,
    agentId: childAgentId,
    conversationId: parent.conversationId,
    parentExecutionId: parent.executionId,
    rootExecutionId: parent.rootExecutionId,
    agentPath,
    depth: parent.depth + 1,
    inputTask: options.task,
    workflowRunId: parent.workflowRunId,
  });

  const fail = async (status: AgentExecutionStatus, error: string): Promise<AgentExecutionResult> => {
    await closeAgentExecution(workspaceId, executionId, { status, error });
    return { executionId, status, output: null, error, usage: null, requiresApproval: false };
  };

  const execution: AgentExecutionContext = {
    executionId,
    rootExecutionId: parent.rootExecutionId,
    parentExecutionId: parent.executionId,
    agentPath,
    depth: parent.depth + 1,
    budget: parent.budget,
    conversationId: parent.conversationId,
    userId: parent.userId,
    toolPolicy: parent.toolPolicy,
    workflowRunId: parent.workflowRunId,
  };

  const gate = deadlineSignal(options.signal, parent.budget.deadline);

  try {
    // A child may delegate further only if it has the capability and the shared
    // budget still allows it; the same limits apply at every depth.
    const delegation = await options.delegationFor?.({ agent: child, execution });

    const prompt = options.context ? `${options.task}\n\nContext from the supervisor:\n${options.context}` : options.task;

    const turn = await startAgentTurn({
      agent: child,
      input: { messages: [{ role: "user", content: prompt }] },
      signal: gate.signal,
      userId: parent.userId,
      // Detached: a delegated task is not a thread the user started, so it
      // writes no conversation and no messages. The conversation id is carried
      // only so the child's MCP audit rows name the conversation that caused
      // them.
      transcript: "detached",
      conversationId: parent.conversationId,
      metadata: { executionId, rootExecutionId: parent.rootExecutionId },
      delegation,
      // The parent's policy, never the child's configuration: an agent that has
      // MCP attached still runs without it when the root did.
      toolPolicy: parent.toolPolicy,
    });

    return await settleTurn({ workspaceId, executionId, turn, gate, budget: parent.budget });
  } catch (error) {
    // The child's internal failure is recorded in full and reported in outline.
    // A provider URL or a stack trace is not something to hand to a model.
    console.error("[agents] delegated execution failed", { executionId, childAgentId, error });
    const timedOut = gate.timedOut();
    return fail(timedOut ? "timed_out" : "failed", timedOut ? "The agent ran out of time." : "The agent could not complete the task.");
  } finally {
    gate.cancel();
  }
}

/**
 * Drains a prepared turn, charges the shared budget, closes the execution row
 * and shapes the narrow result. One implementation for a delegated child and a
 * workflow-started root, because "what leaves an agent execution" is a
 * boundary and boundaries are not written twice.
 */
async function settleTurn(input: {
  workspaceId: string;
  executionId: string;
  turn: AgentTurn;
  gate: { timedOut: () => boolean };
  budget: ExecutionBudget;
}): Promise<AgentExecutionResult> {
  const { workspaceId, executionId, turn, gate, budget } = input;

  const { outcome, streamError, finishReason, timedOut } = await drainTurn(turn, gate, budget);

  const usage = outcome.usage;

  // A stream that died or was cancelled part-way has produced text that LOOKS
  // like an answer and is not one. Reporting it as success would hand a
  // truncated sentence to the next workflow step, or to a supervisor, as if
  // the agent had finished saying it.
  if (!timedOut && (streamError !== null || finishReason === "error" || finishReason === "cancelled")) {
    const error = finishReason === "cancelled" && streamError === null ? "The agent was cancelled before it finished." : "The agent's answer was cut off before it finished.";
    await closeAgentExecution(workspaceId, executionId, {
      status: "failed",
      error,
      requiresApproval: outcome.requiresApproval,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    return { executionId, status: "failed", output: null, error, usage, requiresApproval: outcome.requiresApproval };
  }

  if (timedOut) {
    const error = "The agent ran out of time.";
    await closeAgentExecution(workspaceId, executionId, {
      status: "timed_out",
      error,
      requiresApproval: outcome.requiresApproval,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    return { executionId, status: "timed_out", output: null, error, usage, requiresApproval: outcome.requiresApproval };
  }

  const text = outcome.text.trim();
  const status: AgentExecutionStatus = text ? "succeeded" : "failed";
  const error = text ? null : "The agent returned no answer.";

  await closeAgentExecution(workspaceId, executionId, {
    status,
    output: text || null,
    error,
    requiresApproval: outcome.requiresApproval,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  });

  return { executionId, status, output: text || null, error, usage, requiresApproval: outcome.requiresApproval };
}

/**
 * Consumes a turn's events and ALWAYS finalizes it.
 *
 * `finalize` is where the transcript is written, where usage is metered and -
 * here - where the shared budget is charged. The streaming adapter can never
 * skip it, because `eventsToSseResponse` runs `onFinish` in a `finally`; this
 * is the same guarantee for the collect-to-value adapter. A turn whose
 * generator throws half-way still gets its tokens recorded and charged, and
 * the throw is then re-raised for the caller to close the execution as failed.
 *
 * The deadline is read BEFORE finalize's round-trips, so an answer that
 * completed in time is not reclassified as a timeout because writing its usage
 * rows crossed the line.
 */
async function drainTurn(
  turn: AgentTurn,
  gate: { timedOut: () => boolean },
  budget: ExecutionBudget,
): Promise<{ outcome: AgentTurnOutcome; streamError: string | null; finishReason: string | null; timedOut: boolean }> {
  let streamError: string | null = null;
  let finishReason: string | null = null;
  let timedOut = false;
  let outcome: AgentTurnOutcome | null = null;
  try {
    for await (const event of turn.events) {
      // The agent's events are not the caller's: only its final answer is.
      // They are drained rather than forwarded so nothing intermediate escapes
      // - but what they say about how the stream ENDED is kept.
      if (event.type === "error") {
        streamError = event.message;
        break;
      }
      if (event.type === "done") finishReason = event.finishReason;
    }
  } finally {
    timedOut = gate.timedOut();
    outcome = await turn.finalize();
    if (outcome.usage) budget.remainingTokens -= outcome.usage.inputTokens + outcome.usage.outputTokens;
  }
  return { outcome, streamError, finishReason, timedOut };
}

export interface RunRootAgentOptions {
  workspaceId: string;
  agentId: string;
  task: string;
  userId: string | null;
  signal: AbortSignal;
  /** What the whole tree may reach. A workflow passes `{ mcp: false }`. */
  toolPolicy: AgentToolPolicy;
  workflowRunId: string | null;
  /** Builds the root's delegation context if it may delegate; injected to avoid importing `delegation.ts`. */
  delegationFor?: (input: {
    agent: NonNullable<Awaited<ReturnType<typeof findAgentById>>>;
    execution: AgentExecutionContext;
  }) => Promise<AgentDelegationContext | undefined>;
}

/**
 * Runs an agent as the ROOT of a new execution tree and returns its answer.
 *
 * This is what a workflow's `agent.run` step calls. It is `executeAgentTask`
 * without a parent: the agent is reloaded by `(workspaceId, agentId)` so a
 * stored id proves nothing, it gets a fresh budget from its own configuration,
 * and it runs detached - a workflow step is not a conversation. The tool policy
 * it is given is inherited by anything it delegates to.
 */
export async function runRootAgent(options: RunRootAgentOptions): Promise<AgentExecutionResult> {
  const { workspaceId, agentId } = options;

  const agent = await findAgentById(workspaceId, agentId);

  const refused = (error: string): AgentExecutionResult => ({
    executionId: "",
    status: "refused",
    output: null,
    error,
    usage: null,
    requiresApproval: false,
  });
  if (!agent) return refused("That agent is not available in this workspace.");
  if (agent.status === "archived") return refused("That agent is archived and cannot run.");

  const root = await openRootExecution({
    workspaceId,
    agentId,
    conversationId: null,
    budget: createBudget(agent.delegationConfig),
    userId: options.userId,
    toolPolicy: options.toolPolicy,
    workflowRunId: options.workflowRunId,
    inputTask: options.task,
  });

  const gate = deadlineSignal(options.signal, root.budget.deadline);

  try {
    const delegation = await options.delegationFor?.({ agent, execution: root });

    const turn = await startAgentTurn({
      agent,
      input: { messages: [{ role: "user", content: options.task }] },
      signal: gate.signal,
      userId: options.userId,
      transcript: "detached",
      conversationId: null,
      metadata: {
        executionId: root.executionId,
        ...(options.workflowRunId ? { workflowRunId: options.workflowRunId } : {}),
      },
      delegation,
      toolPolicy: options.toolPolicy,
    });

    return await settleTurn({ workspaceId, executionId: root.executionId, turn, gate, budget: root.budget });
  } catch (error) {
    console.error("[agents] root execution failed", { executionId: root.executionId, agentId, error });
    const timedOut = gate.timedOut();
    const message = timedOut ? "The agent ran out of time." : "The agent could not complete the task.";
    await closeAgentExecution(workspaceId, root.executionId, { status: timedOut ? "timed_out" : "failed", error: message });
    return { executionId: root.executionId, status: timedOut ? "timed_out" : "failed", output: null, error: message, usage: null, requiresApproval: false };
  } finally {
    gate.cancel();
  }
}

/** Opens the root execution for a turn that may delegate, or that a workflow started. */
export async function openRootExecution(input: {
  workspaceId: string;
  agentId: string;
  conversationId: string | null;
  budget: ExecutionBudget;
  userId: string | null;
  /**
   * Required, not defaulted. The root is where a restriction is placed for the
   * whole tree, and "forgot to pass it" must be a type error rather than a
   * silent grant of everything the agent has.
   */
  toolPolicy: AgentToolPolicy;
  workflowRunId?: string | null;
  /** The task a workflow handed over, recorded like a delegated task is. */
  inputTask?: string | null;
}): Promise<AgentExecutionContext> {
  const executionId = await openAgentExecution({
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    conversationId: input.conversationId,
    agentPath: [input.agentId],
    depth: 0,
    inputTask: input.inputTask ?? null,
    workflowRunId: input.workflowRunId ?? null,
  });
  return {
    executionId,
    rootExecutionId: executionId,
    parentExecutionId: null,
    agentPath: [input.agentId],
    depth: 0,
    budget: input.budget,
    conversationId: input.conversationId,
    userId: input.userId,
    toolPolicy: input.toolPolicy,
    workflowRunId: input.workflowRunId ?? null,
  };
}
