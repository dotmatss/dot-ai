import { assertWorkspaceActive, assertUserActive } from "@/server/auth/lifecycle";
import "server-only";

import { runRootAgent } from "@/features/agents/server/agent-execution";
import { loadDelegationContext } from "@/features/agents/server/delegation";
import { resolveCredential } from "@/features/integrations/server/credential-resolver";
import { definitionErrors, validateDefinition } from "@/features/workflows/domain/definition";
import {
  executeDefinition,
  type ExecutionResult,
  type WorkflowAgentRunner,
  type WorkflowAiGateway,
  type WorkflowCredentialResolver,
} from "@/features/workflows/domain/execution";
import {
  finishWorkflowRun,
  findWorkflowRunById,
  insertWorkflowRun,
} from "@/features/workflows/server/workflow-run-repository";
import { getWorkflow, type ActorContext } from "@/features/workflows/server/workflow-service";
import type { WorkflowRun, WorkflowTriggerKind } from "@/features/workflows/types";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import { getAiGateway } from "@/server/ai";
import { withWorkspace } from "@/server/db/client";
import { recordUsageBatch, type UsageKind } from "@/server/usage/record-usage";

/**
 * Run lifecycle: persist a `running` row, execute the definition with the
 * pure engine, then persist the outcome, usage and audit entry.
 *
 * Runs are executed inline. That is acceptable for the short, sequential
 * workflows this release supports, but the production path is a queue: a
 * worker picks up `queued` rows so a long run survives a deploy and cannot
 * hold an HTTP request open. The row is inserted before execution and closed
 * afterwards precisely so a queue can take over without a schema change.
 */

/**
 * Total wall clock a run may spend across every `agent.run` step. Equal to the
 * largest single-agent ceiling, on purpose: a run that runs agents in sequence
 * shares one agent's worth of time between them, and a run that needs more is
 * a run that needs the background execution this release does not have.
 */
export const WORKFLOW_AGENT_WALL_CLOCK_MS = 120_000;

export interface StartWorkflowRunOptions {
  ctx: ActorContext;
  workflowId: string;
  input?: Record<string, unknown>;
  trigger?: {
    kind: WorkflowTriggerKind;
    label?: string | null;
    payload?: Record<string, unknown>;
  };
  /** Injected so the executor can be driven with a stub gateway. */
  gateway?: WorkflowAiGateway;
  /** Injected in tests; defaults to the real, workspace-bound runner below. */
  runAgent?: WorkflowAgentRunner;
  /** Injected in tests; defaults to the real, workspace-bound resolver below. */
  resolveCredential?: WorkflowCredentialResolver;
  signal?: AbortSignal;
}

/**
 * The only way a workflow reaches an agent.
 *
 * Bound to the run's workspace and to the run id, so the agent in a step's
 * config is resolved through THIS workspace - a stored id from anywhere else is
 * "not available" - and every execution it starts is traceable from the run.
 *
 * MCP is off for the whole tree. A workflow step can be reached without a
 * person in the loop, and this is the line that keeps it from becoming an
 * indirect route to a customer's MCP servers: the agent runs on its
 * instructions, knowledge and built-in tools, and no MCP declaration reaches the
 * model. Anything the agent delegates to inherits the same restriction.
 * Enabling MCP here is a separate security decision, not a flag to flip.
 */
function workflowAgentRunner(ctx: ActorContext, runId: string): WorkflowAgentRunner {
  const toolPolicy = { mcp: false };
  // One wall-clock allowance for ALL agent steps in this run, spent in order.
  // Each agent brings its own per-turn budget, but without a ceiling above them
  // a chain of agent steps would multiply that budget by the number of steps -
  // inside a single request handler that has to finish before the platform
  // kills it and strands the run row as `running`.
  const agentDeadline = Date.now() + WORKFLOW_AGENT_WALL_CLOCK_MS;

  return async ({ agentId, task, signal }) => {
    const remaining = agentDeadline - Date.now();
    if (remaining <= 0) {
      return { executionId: "", status: "timed_out", output: null, error: "This run has used its time for agent steps.", usage: null, requiresApproval: false };
    }

    const gate = new AbortController();
    let runClockExpired = false;
    const timer = setTimeout(() => {
      runClockExpired = true;
      gate.abort();
    }, remaining);
    const onAbort = () => gate.abort();
    if (signal?.aborted) gate.abort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const result = await runRootAgent({
        workspaceId: ctx.workspaceId,
        agentId,
        task,
        userId: ctx.userId,
        signal: gate.signal,
        toolPolicy,
        workflowRunId: runId,
        delegationFor: ({ agent, execution }) =>
          loadDelegationContext({ workspaceId: ctx.workspaceId, agent, execution, userId: ctx.userId }),
      });
      // The agent's own gate saw a plain abort; the run knows it was the clock.
      return runClockExpired && result.status !== "succeeded"
        ? { ...result, status: "timed_out", error: "This run has used its time for agent steps." }
        : result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  };
}


/**
 * The only way a workflow reaches a stored credential.
 *
 * Bound to the run's workspace, so a credential id in a definition resolves
 * through THIS workspace - an id copied in from another workspace's export is
 * "no longer available", not somebody else's token. The integrations feature
 * owns the rules about what a credential is and how it is sealed; this asks it
 * for a header and hands that header to the engine.
 *
 * What comes back is plaintext secret material. It is passed to the engine and
 * nowhere else: never logged here, never put on the run row, never in an
 * activity entry.
 */
function workflowCredentialResolver(ctx: ActorContext): WorkflowCredentialResolver {
  return async (credentialId) => {
    const credential = await resolveCredential(ctx.workspaceId, credentialId);
    if (!credential) return null;
    // Narrowed on purpose: the engine gets a header, not a credential record.
    return { name: credential.name, headerName: credential.headerName, headerValue: credential.headerValue };
  };
}

function usageEvents(runId: string, result: ExecutionResult): Array<{ kind: UsageKind; quantity: number; refType: string; refId: string }> {
  const events = [{ kind: "workflow_run" as UsageKind, quantity: 1, refType: "workflow_run", refId: runId }];
  if (result.usage.inputTokens > 0) {
    events.push({ kind: "tokens_in", quantity: result.usage.inputTokens, refType: "workflow_run", refId: runId });
  }
  if (result.usage.outputTokens > 0) {
    events.push({ kind: "tokens_out", quantity: result.usage.outputTokens, refType: "workflow_run", refId: runId });
  }
  return events;
}

export async function startWorkflowRun(options: StartWorkflowRunOptions): Promise<WorkflowRun> {
  const { ctx, workflowId } = options;
  await assertWorkspaceActive(ctx.workspaceId);
  if (ctx.userId) await assertUserActive(ctx.userId);
  const workflow = await getWorkflow(ctx.workspaceId, workflowId);
  if (workflow.status === "archived") {
    throw ApiError.conflict("Archived workflows cannot run. Restore it to a draft first.");
  }

  const blocking = definitionErrors(validateDefinition(workflow.definition));
  const firstBlocking = blocking[0];
  if (firstBlocking) {
    throw ApiError.validation({ definition: [firstBlocking.message] }, "This workflow cannot run yet");
  }

  const triggerKind = options.trigger?.kind ?? "manual";
  const triggerPayload = options.trigger?.payload ?? {};
  const runId = await withWorkspace(ctx.workspaceId, (client) =>
    insertWorkflowRun(
      {
        workspaceId: ctx.workspaceId,
        workflowId,
        status: "running",
        trigger: {
          kind: triggerKind,
          label: options.trigger?.label ?? null,
          actorId: ctx.userId,
          payload: triggerPayload,
        },
        input: options.input ?? {},
        startedAt: new Date(),
      },
      client,
    ),
  );

  let result: ExecutionResult;
  try {
    result = await executeDefinition({
      definition: workflow.definition,
      gateway: options.gateway ?? getAiGateway(),
      trigger: { kind: triggerKind, ...triggerPayload },
      input: options.input ?? {},
      signal: options.signal,
      runAgent: options.runAgent ?? workflowAgentRunner(ctx, runId),
      resolveCredential: options.resolveCredential ?? workflowCredentialResolver(ctx),
    });
  } catch (error) {
    // An engine-level failure must still close the run, otherwise the row
    // stays "running" forever.
    result = {
      status: "failed",
      steps: [],
      output: null,
      error: error instanceof Error ? error.message : "The run failed unexpectedly.",
      usage: { aiCalls: 0, inputTokens: 0, outputTokens: 0 },
      context: { trigger: {}, input: {}, vars: {}, nodes: {} },
    };
  }

  await withWorkspace(ctx.workspaceId, async (client) => {
    await finishWorkflowRun(
      ctx.workspaceId,
      runId,
      {
        status: result.status,
        steps: result.steps,
        output: result.output,
        error: result.error,
        finishedAt: new Date(),
      },
      client,
    );
    await recordUsageBatch(ctx.workspaceId, usageEvents(runId, result), client);
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "workflow_run",
        entityId: runId,
        action: `run:${result.status}`,
        summary: `Workflow “${workflow.name}” run ${result.status}`,
        metadata: {
          workflowId,
          version: workflow.version,
          steps: result.steps.length,
          trigger: triggerKind,
          ...(result.error ? { error: result.error } : {}),
        },
      },
      client,
    );
  });

  const run = await findWorkflowRunById(ctx.workspaceId, workflowId, runId);
  if (!run) throw ApiError.internal("The run could not be read back after execution");
  return run;
}
