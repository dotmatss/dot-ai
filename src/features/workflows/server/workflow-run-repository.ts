import "server-only";

import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";

import {
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_TRIGGER_KINDS,
  type WorkflowRun,
  type WorkflowRunListFilters,
  type WorkflowRunStatus,
  type WorkflowRunStep,
  type WorkflowRunSummary,
  type WorkflowRunTrigger,
  type WorkflowTriggerKind,
} from "@/features/workflows/types";
import { withDb, type DatabaseClient } from "@/server/db/client";
import { workflowRuns } from "@/server/db/schema";
import { normalizePage, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

interface RunRow {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  trigger: unknown;
  input?: unknown;
  output?: unknown;
  steps?: unknown;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  stepCount?: number | null;
}

/**
 * A list row carries the step COUNT, never the steps themselves: the step
 * array holds every node's input and output, which is far too large to ship
 * for a whole page of runs. `jsonb_array_length` stays a SQL expression
 * because it is precisely the PostgreSQL function that avoids reading the blob.
 */
const runSummarySelection = {
  id: workflowRuns.id,
  workflowId: workflowRuns.workflowId,
  status: workflowRuns.status,
  trigger: workflowRuns.trigger,
  error: workflowRuns.error,
  startedAt: workflowRuns.startedAt,
  finishedAt: workflowRuns.finishedAt,
  createdAt: workflowRuns.createdAt,
  stepCount: sql<number>`jsonb_array_length(COALESCE(${workflowRuns.steps}, '[]'::jsonb))`.mapWith(Number),
};

const runDetailSelection = {
  id: workflowRuns.id,
  workflowId: workflowRuns.workflowId,
  status: workflowRuns.status,
  trigger: workflowRuns.trigger,
  input: workflowRuns.input,
  output: workflowRuns.output,
  steps: workflowRuns.steps,
  error: workflowRuns.error,
  startedAt: workflowRuns.startedAt,
  finishedAt: workflowRuns.finishedAt,
  createdAt: workflowRuns.createdAt,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Only the trigger kind and label are exposed: the stored payload can contain
 * an actor id and raw webhook data that the client has no need for.
 */
function mapTrigger(value: unknown): WorkflowRunTrigger {
  const record = asRecord(value);
  const kind = record?.kind;
  const label = record?.label;
  return {
    kind: (WORKFLOW_TRIGGER_KINDS as readonly string[]).includes(String(kind)) ? (kind as WorkflowTriggerKind) : "manual",
    label: typeof label === "string" && label.trim().length > 0 ? label : null,
  };
}

function mapSteps(value: unknown): WorkflowRunStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is WorkflowRunStep => {
    const record = asRecord(entry);
    return typeof record?.nodeId === "string" && typeof record.type === "string";
  });
}

function mapSummary(row: RunRow): WorkflowRunSummary {
  return {
    id: row.id,
    workflowId: row.workflowId,
    status: row.status,
    trigger: mapTrigger(row.trigger),
    stepCount: Number(row.stepCount ?? 0),
    error: row.error,
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
    createdAt: toIsoRequired(row.createdAt),
  };
}

function mapRun(row: RunRow): WorkflowRun {
  const steps = mapSteps(row.steps);
  return {
    ...mapSummary({ ...row, stepCount: steps.length }),
    input: asRecord(row.input),
    output: asRecord(row.output),
    steps,
  };
}

export async function listWorkflowRuns(
  workspaceId: string,
  workflowId: string,
  filters: WorkflowRunListFilters,
): Promise<Paginated<WorkflowRunSummary>> {
  const page = normalizePage(filters);

  const conditions: Array<SQL | undefined> = [eq(workflowRuns.workspaceId, workspaceId), eq(workflowRuns.workflowId, workflowId)];
  if (filters.status) conditions.push(eq(workflowRuns.status, filters.status));
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db
        .select(runSummarySelection)
        .from(workflowRuns)
        .where(where)
        .orderBy(desc(workflowRuns.createdAt))
        .limit(page.pageSize)
        .offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(workflowRuns).where(where)),
  ]);

  return toPaginated(rows.map(mapSummary), totals[0]?.total ?? 0, page);
}

export async function findWorkflowRunById(
  workspaceId: string,
  workflowId: string,
  runId: string,
  client?: DatabaseClient,
): Promise<WorkflowRun | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(runDetailSelection)
        .from(workflowRuns)
        .where(and(eq(workflowRuns.workspaceId, workspaceId), eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.id, runId)))
        .limit(1),
    client,
  );
  return rows[0] ? mapRun(rows[0]) : null;
}

export interface InsertRunInput {
  workspaceId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  trigger: Record<string, unknown>;
  input: Record<string, unknown> | null;
  startedAt: Date | null;
}

export async function insertWorkflowRun(input: InsertRunInput, client?: DatabaseClient): Promise<string> {
  const inserted = await withDb(
    (db) =>
      db
        .insert(workflowRuns)
        .values({
          workspaceId: input.workspaceId,
          workflowId: input.workflowId,
          status: input.status,
          trigger: input.trigger,
          input: input.input,
          startedAt: input.startedAt,
        })
        .returning({ id: workflowRuns.id }),
    client,
  );
  const id = inserted[0]?.id;
  if (!id) throw new Error("Failed to insert workflow run");
  return id;
}

export interface FinishRunInput {
  status: WorkflowRunStatus;
  steps: WorkflowRunStep[];
  output: Record<string, unknown> | null;
  error: string | null;
  finishedAt: Date;
}

export async function finishWorkflowRun(
  workspaceId: string,
  runId: string,
  input: FinishRunInput,
  client?: DatabaseClient,
): Promise<void> {
  if (!(WORKFLOW_RUN_STATUSES as readonly string[]).includes(input.status)) {
    throw new Error(`Unknown run status: ${input.status}`);
  }
  await withDb(
    (db) =>
      db
        .update(workflowRuns)
        .set({
          status: input.status,
          steps: input.steps,
          output: input.output,
          error: input.error,
          finishedAt: input.finishedAt,
        })
        .where(and(eq(workflowRuns.workspaceId, workspaceId), eq(workflowRuns.id, runId))),
    client,
  );
}
