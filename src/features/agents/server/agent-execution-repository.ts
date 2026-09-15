import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";
import type { PoolClient } from "pg";

import type { AgentExecutionNode, AgentExecutionStatus } from "@/features/agents/types";
import { withDb } from "@/server/db/client";
import { agentExecutions } from "@/server/db/schema";
import { toIso, toIsoRequired } from "@/server/db/sql";

/**
 * Execution records.
 *
 * One row per agent turn that is part of a delegating request. The row is
 * opened before the turn runs and closed after it, so a crash leaves a
 * `running` row rather than no evidence at all - the same shape `workflow_runs`
 * uses, and for the same reason.
 */

export interface OpenExecutionInput {
  workspaceId: string;
  agentId: string;
  conversationId: string | null;
  /** Omitted on a root execution, which becomes its own root. */
  parentExecutionId?: string | null;
  rootExecutionId?: string | null;
  agentPath: string[];
  depth: number;
  inputTask?: string | null;
  /** The workflow run whose `agent.run` step started this, when one did. */
  workflowRunId?: string | null;
}

export async function openAgentExecution(input: OpenExecutionInput, client?: PoolClient): Promise<string> {
  // `root_execution_id` is NOT NULL and a root execution is its own root, so
  // the id has to exist before the insert rather than being defaulted by it.
  const id = randomUUID();

  await withDb(
    (db) =>
      db.insert(agentExecutions).values({
        id,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        rootExecutionId: input.rootExecutionId ?? id,
        parentExecutionId: input.parentExecutionId ?? null,
        agentPath: input.agentPath,
        depth: input.depth,
        inputTask: input.inputTask ?? null,
        workflowRunId: input.workflowRunId ?? null,
        status: "running",
      }),
    client,
  );
  return id;
}

/**
 * Attaches a root execution to the conversation it belongs to.
 *
 * The row is opened before the turn starts, because a child's
 * `parent_execution_id` must reference something that exists - but the
 * conversation is only resolved once the turn begins. This closes that gap and
 * runs only for a supervisor.
 */
export async function attachExecutionConversation(
  workspaceId: string,
  executionId: string,
  conversationId: string,
  client?: PoolClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(agentExecutions)
        .set({ conversationId })
        .where(and(eq(agentExecutions.workspaceId, workspaceId), eq(agentExecutions.id, executionId))),
    client,
  );
}

export interface CloseExecutionInput {
  status: AgentExecutionStatus;
  output?: string | null;
  error?: string | null;
  requiresApproval?: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

export async function closeAgentExecution(
  workspaceId: string,
  executionId: string,
  input: CloseExecutionInput,
  client?: PoolClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(agentExecutions)
        .set({
          status: input.status,
          output: input.output ?? null,
          error: input.error ?? null,
          requiresApproval: input.requiresApproval ?? false,
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          finishedAt: new Date(),
        })
        .where(and(eq(agentExecutions.workspaceId, workspaceId), eq(agentExecutions.id, executionId))),
    client,
  );
}

/**
 * Every execution in one tree, oldest first.
 *
 * Reads `root_execution_id` rather than walking parents, which is why that
 * column is denormalised onto every row.
 */
export async function listExecutionTree(workspaceId: string, rootExecutionId: string): Promise<AgentExecutionNode[]> {
  const rows = await withDb((db) =>
    db
      .select({
        id: agentExecutions.id,
        agentId: agentExecutions.agentId,
        parentExecutionId: agentExecutions.parentExecutionId,
        depth: agentExecutions.depth,
        status: agentExecutions.status,
        inputTask: agentExecutions.inputTask,
        error: agentExecutions.error,
        requiresApproval: agentExecutions.requiresApproval,
        inputTokens: agentExecutions.inputTokens,
        outputTokens: agentExecutions.outputTokens,
        startedAt: agentExecutions.startedAt,
        finishedAt: agentExecutions.finishedAt,
      })
      .from(agentExecutions)
      .where(and(eq(agentExecutions.workspaceId, workspaceId), eq(agentExecutions.rootExecutionId, rootExecutionId)))
      .orderBy(asc(agentExecutions.startedAt)),
  );

  return rows.map((row) => ({
    id: row.id,
    agentId: row.agentId,
    parentExecutionId: row.parentExecutionId,
    depth: row.depth,
    status: row.status,
    // The delegated task, never the child's answer: an execution tree is for
    // understanding what ran, and the answer already reached the user through
    // the supervisor's reply.
    inputTask: row.inputTask,
    error: row.error,
    requiresApproval: row.requiresApproval,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    startedAt: toIsoRequired(row.startedAt),
    finishedAt: toIso(row.finishedAt),
  }));
}
