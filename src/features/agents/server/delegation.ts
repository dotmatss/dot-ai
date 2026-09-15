import "server-only";

import { z } from "zod";

import {
  DELEGATION_TOOL_NAME,
  type AgentDelegationContext,
  type AuthorizedDelegation,
  type DelegationOutcome,
  type DelegationPlan,
} from "@/features/agents/server/agent-engine";
import { executeAgentTask, type AgentExecutionContext } from "@/features/agents/server/agent-execution";
import { listDelegationTargets } from "@/features/agents/server/agent-repository";
import type { Agent, DelegationTarget } from "@/features/agents/types";
import type { AiToolDefinition } from "@/types/ai";

/**
 * The supervisor's delegation capability.
 *
 * Deliberately NOT a member of the built-in tool registry. Those six tools are
 * simulated by design, and that invariant is worth more than the convenience of
 * one shared list: delegation really executes, so it is a platform capability
 * offered only to an agent that has been granted it, resolved through its own
 * module, and recognised by the engine by name.
 *
 * WHAT THE MODEL DECIDES, AND WHAT IT DOES NOT
 * --------------------------------------------
 * The model may decide *whether* to delegate, *which* of the agents it was
 * shown to use and *what* to ask. It decides nothing else. Whether that agent
 * may actually be called, whether the depth allows it, whether the budget
 * allows it and whether the deadline has passed are all re-decided here from
 * server state, every single call. An `agent_id` in a model's output is a
 * request, never an authorization - which is why the model is shown names and
 * never asked to produce a database id it could have invented.
 */

/** Arguments the model supplies. Validated like any other untrusted input. */
const delegationArgumentsSchema = z.object({
  agent: z.string().trim().min(1).max(120),
  task: z.string().trim().min(1).max(4_000),
  context: z.string().trim().max(4_000).optional(),
});

function toolDefinition(targets: readonly DelegationTarget[]): AiToolDefinition {
  return {
    name: DELEGATION_TOOL_NAME,
    description:
      "Ask one of your specialist agents to carry out a task and return its answer. Use it when the task falls in an agent's area rather than answering yourself. You receive only that agent's answer.",
    parameters: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          // An enumeration, so an invented name fails at the provider rather
          // than arriving here as a lookup for something that does not exist.
          enum: targets.map((target) => target.name),
          description: "Which agent to ask.",
        },
        task: { type: "string", description: "What that agent should do, stated plainly and completely." },
        context: { type: "string", description: "Optional background the agent needs. Never include credentials." },
      },
      required: ["agent", "task"],
      additionalProperties: false,
    },
  };
}

export interface LoadDelegationOptions {
  workspaceId: string;
  agent: Agent;
  execution: AgentExecutionContext;
  userId: string | null;
}

/**
 * Builds the delegation context for one agent, or nothing when it may not
 * delegate at all.
 *
 * Returning `undefined` matters: the engine then offers the model no delegation
 * tool, so an agent without the capability is not merely refused if it asks -
 * it is never told the option exists.
 */
export async function loadDelegationContext(options: LoadDelegationOptions): Promise<AgentDelegationContext | undefined> {
  const { workspaceId, agent, execution } = options;

  if (!agent.canDelegate) return undefined;
  // Depth is checked when building the context as well as before running, so a
  // child at maximum depth is never even offered the tool.
  if (execution.depth >= execution.budget.maxDepth) return undefined;

  const targets = await listDelegationTargets(workspaceId, agent.id);
  const usable = targets.filter((target) => target.enabled && target.status !== "archived");
  if (usable.length === 0) return undefined;

  // Names as shown to the model, mapped back to ids we looked up ourselves.
  const byName = new Map(usable.map((target) => [target.name.toLowerCase(), target]));

  return {
    definitions: [toolDefinition(usable)],

    isDelegationTool(name: string): boolean {
      return name === DELEGATION_TOOL_NAME;
    },

    prepare(args: unknown): DelegationPlan {
      const parsed = delegationArgumentsSchema.safeParse(args);
      if (!parsed.success) {
        return { ok: false, status: "unknown_tool", reason: "That delegation request was not valid. Give an agent name and a task." };
      }

      const target = byName.get(parsed.data.agent.toLowerCase());
      if (!target) {
        // Covers a hallucinated name, an agent in another workspace, one that
        // exists but was never granted, and one whose grant is disabled. They
        // are one answer on purpose: which of them is true is not the model's
        // business.
        return { ok: false, status: "unavailable", reason: `You are not authorized to delegate to “${parsed.data.agent}”.` };
      }

      // Cycle detection. The grant graph is configuration and can contain a
      // loop; what must not happen is a loop being *walked*.
      if (execution.agentPath.includes(target.id)) {
        return { ok: false, status: "unavailable", reason: `${target.name} is already handling part of this request, so it cannot be asked again.` };
      }
      if (execution.depth + 1 > execution.budget.maxDepth) {
        return { ok: false, status: "unavailable", reason: "This request has reached its delegation depth limit." };
      }
      if (execution.budget.remainingDelegations <= 0) {
        return { ok: false, status: "unavailable", reason: "This request has used all of its delegations." };
      }
      if (execution.budget.remainingTokens <= 0) {
        return { ok: false, status: "unavailable", reason: "This request has used its token budget." };
      }
      if (Date.now() >= execution.budget.deadline) {
        return { ok: false, status: "unavailable", reason: "This request has run out of time." };
      }

      return {
        ok: true,
        childAgentId: target.id,
        childAgentName: target.name,
        task: parsed.data.task,
        context: parsed.data.context ?? null,
      };
    },

    async run(plan: AuthorizedDelegation, signal: AbortSignal): Promise<DelegationOutcome> {
      // Claimed before the child starts, so two delegations in one pass cannot
      // both pass a check that only one of them should.
      execution.budget.remainingDelegations -= 1;

      const result = await executeAgentTask({
        workspaceId,
        childAgentId: plan.childAgentId,
        task: plan.task,
        context: plan.context,
        parent: execution,
        signal,
        delegationFor: async ({ agent: child, execution: childExecution }) =>
          child
            ? loadDelegationContext({ workspaceId, agent: child, execution: childExecution, userId: options.userId })
            : undefined,
      });

      if (result.status === "succeeded" && result.output) {
        const approval = result.requiresApproval
          ? ` ${plan.childAgentName} needs a person to approve an action before it can finish; the answer below reflects what it could do without that.`
          : "";
        return {
          resultText: result.output,
          message: `${plan.childAgentName} answered.${approval}`,
          status: "executed",
          requiresApproval: result.requiresApproval,
        };
      }

      // A failure is reported to the supervisor as a fact it can work around -
      // delegate elsewhere, continue with what it has, or say what is missing.
      // It is never retried automatically: a retry is another full agent turn,
      // and nothing here knows whether the task was side-effecting.
      const reason =
        result.status === "timed_out"
          ? `${plan.childAgentName} ran out of time and returned nothing.`
          : `${plan.childAgentName} could not complete the task.`;
      return { resultText: null, message: reason, status: "unavailable", requiresApproval: result.requiresApproval };
    },
  };
}
