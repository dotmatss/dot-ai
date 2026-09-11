import "server-only";

import { definitionErrors, validateDefinition } from "@/features/workflows/domain/definition";
import { executeDefinition, type ExecutionResult, type WorkflowAiGateway } from "@/features/workflows/domain/execution";
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
  signal?: AbortSignal;
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
