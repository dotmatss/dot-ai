import "server-only";

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
import { query, queryOne, type Queryable } from "@/server/db/client";
import { normalizePage, ParamBuilder, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

interface RunRow {
  id: string;
  workflow_id: string;
  status: WorkflowRunStatus;
  trigger: unknown;
  input: unknown;
  output: unknown;
  steps: unknown;
  error: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  step_count?: string | number | null;
}

const SELECT_RUN_SUMMARY = `
  SELECT r.id, r.workflow_id, r.status, r.trigger, r.error, r.started_at, r.finished_at, r.created_at,
         jsonb_array_length(COALESCE(r.steps, '[]'::jsonb)) AS step_count
  FROM workflow_runs r
`;

const SELECT_RUN_DETAIL = `
  SELECT r.id, r.workflow_id, r.status, r.trigger, r.input, r.output, r.steps, r.error,
         r.started_at, r.finished_at, r.created_at
  FROM workflow_runs r
`;

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
    workflowId: row.workflow_id,
    status: row.status,
    trigger: mapTrigger(row.trigger),
    stepCount: Number(row.step_count ?? 0),
    error: row.error,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    createdAt: toIsoRequired(row.created_at),
  };
}

function mapRun(row: RunRow): WorkflowRun {
  const steps = mapSteps(row.steps);
  return {
    ...mapSummary({ ...row, step_count: steps.length }),
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
  const params = new ParamBuilder();
  const where: string[] = [
    `r.workspace_id = ${params.add(workspaceId)}`,
    `r.workflow_id = ${params.add(workflowId)}`,
  ];
  if (filters.status) where.push(`r.status = ${params.add(filters.status)}`);
  const whereSql = where.join(" AND ");
  const filterValues = [...params.values];

  const [rows, countRow] = await Promise.all([
    query<RunRow>(
      `${SELECT_RUN_SUMMARY} WHERE ${whereSql} ORDER BY r.created_at DESC LIMIT ${params.add(page.pageSize)} OFFSET ${params.add(page.offset)}`,
      params.values,
    ),
    queryOne<{ count: string }>(`SELECT count(*) AS count FROM workflow_runs r WHERE ${whereSql}`, filterValues),
  ]);

  return toPaginated(rows.map(mapSummary), Number(countRow?.count ?? 0), page);
}

export async function findWorkflowRunById(
  workspaceId: string,
  workflowId: string,
  runId: string,
  client?: Queryable,
): Promise<WorkflowRun | null> {
  const row = await queryOne<RunRow>(
    `${SELECT_RUN_DETAIL} WHERE r.workspace_id = $1 AND r.workflow_id = $2 AND r.id = $3`,
    [workspaceId, workflowId, runId],
    client,
  );
  return row ? mapRun(row) : null;
}

export interface InsertRunInput {
  workspaceId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  trigger: Record<string, unknown>;
  input: Record<string, unknown> | null;
  startedAt: Date | null;
}

export async function insertWorkflowRun(input: InsertRunInput, client?: Queryable): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO workflow_runs (workspace_id, workflow_id, status, trigger, input, started_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6) RETURNING id`,
    [
      input.workspaceId,
      input.workflowId,
      input.status,
      JSON.stringify(input.trigger),
      input.input === null ? null : JSON.stringify(input.input),
      input.startedAt,
    ],
    client,
  );
  if (!row) throw new Error("Failed to insert workflow run");
  return row.id;
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
  client?: Queryable,
): Promise<void> {
  if (!(WORKFLOW_RUN_STATUSES as readonly string[]).includes(input.status)) {
    throw new Error(`Unknown run status: ${input.status}`);
  }
  await query(
    `UPDATE workflow_runs
     SET status = $3, steps = $4::jsonb, output = $5::jsonb, error = $6, finished_at = $7
     WHERE workspace_id = $1 AND id = $2`,
    [
      workspaceId,
      runId,
      input.status,
      JSON.stringify(input.steps),
      input.output === null ? null : JSON.stringify(input.output),
      input.error,
      input.finishedAt,
    ],
    client,
  );
}
