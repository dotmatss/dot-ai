import "server-only";

import { coerceDefinition, type WorkflowDefinition } from "@/features/workflows/domain/definition";
import type { Workflow, WorkflowListFilters, WorkflowRunStatus, WorkflowStatus, WorkflowSummary } from "@/features/workflows/types";
import { query, queryOne, type Queryable } from "@/server/db/client";
import { likePattern, normalizePage, ParamBuilder, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

interface WorkflowRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  definition: unknown;
  version: number;
  created_at: Date;
  updated_at: Date;
  run_count: string | number;
  last_run_at: Date | null;
  last_run_status: WorkflowRunStatus | null;
}

/**
 * The last run is joined laterally so lists show run health without an N+1
 * query. Both sides of the join filter `workspace_id` explicitly, matching the
 * RLS policy rather than relying on it.
 */
const SELECT_WORKFLOW = `
  SELECT w.id, w.workspace_id, w.name, w.description, w.status, w.definition, w.version, w.created_at, w.updated_at,
         (SELECT count(*) FROM workflow_runs r WHERE r.workflow_id = w.id AND r.workspace_id = w.workspace_id) AS run_count,
         last_run.created_at AS last_run_at,
         last_run.status AS last_run_status
  FROM workflows w
  LEFT JOIN LATERAL (
    SELECT r.status, r.created_at
    FROM workflow_runs r
    WHERE r.workflow_id = w.id AND r.workspace_id = w.workspace_id
    ORDER BY r.created_at DESC
    LIMIT 1
  ) last_run ON true
`;

function mapWorkflow(row: WorkflowRow): Workflow {
  const definition = coerceDefinition(row.definition);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    status: row.status,
    version: row.version,
    definition,
    stepCount: definition.nodes.length,
    runCount: Number(row.run_count ?? 0),
    lastRunAt: toIso(row.last_run_at),
    lastRunStatus: row.last_run_status,
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
  };
}

export function toWorkflowSummary(workflow: Workflow): WorkflowSummary {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    version: workflow.version,
    stepCount: workflow.stepCount,
    runCount: workflow.runCount,
    lastRunAt: workflow.lastRunAt,
    lastRunStatus: workflow.lastRunStatus,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

export async function listWorkflows(workspaceId: string, filters: WorkflowListFilters): Promise<Paginated<WorkflowSummary>> {
  const page = normalizePage(filters);
  const params = new ParamBuilder();
  const where: string[] = [`w.workspace_id = ${params.add(workspaceId)}`];
  if (filters.status) {
    where.push(`w.status = ${params.add(filters.status)}`);
  } else {
    where.push(`w.status <> 'archived'`);
  }
  if (filters.q) {
    const pattern = params.add(likePattern(filters.q));
    where.push(`(w.name ILIKE ${pattern} OR w.description ILIKE ${pattern})`);
  }
  const whereSql = where.join(" AND ");
  const filterValues = [...params.values];

  const [rows, countRow] = await Promise.all([
    query<WorkflowRow>(
      `${SELECT_WORKFLOW} WHERE ${whereSql} ORDER BY w.updated_at DESC LIMIT ${params.add(page.pageSize)} OFFSET ${params.add(page.offset)}`,
      params.values,
    ),
    queryOne<{ count: string }>(`SELECT count(*) AS count FROM workflows w WHERE ${whereSql}`, filterValues),
  ]);

  return toPaginated(rows.map(mapWorkflow).map(toWorkflowSummary), Number(countRow?.count ?? 0), page);
}

export async function findWorkflowById(workspaceId: string, workflowId: string, client?: Queryable): Promise<Workflow | null> {
  const row = await queryOne<WorkflowRow>(
    `${SELECT_WORKFLOW} WHERE w.workspace_id = $1 AND w.id = $2`,
    [workspaceId, workflowId],
    client,
  );
  return row ? mapWorkflow(row) : null;
}

export interface InsertWorkflowInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  description: string | null;
  definition: WorkflowDefinition;
}

export async function insertWorkflow(input: InsertWorkflowInput, client?: Queryable): Promise<Workflow> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO workflows (workspace_id, created_by, name, description, definition)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
    [input.workspaceId, input.createdBy, input.name, input.description, JSON.stringify(input.definition)],
    client,
  );
  if (!row) throw new Error("Failed to insert workflow");
  const workflow = await findWorkflowById(input.workspaceId, row.id, client);
  if (!workflow) throw new Error("Workflow vanished after insert");
  return workflow;
}

export interface WorkflowPatch {
  name?: string;
  description?: string | null;
  status?: WorkflowStatus;
  definition?: WorkflowDefinition;
  version?: number;
}

export async function updateWorkflowRow(
  workspaceId: string,
  workflowId: string,
  patch: WorkflowPatch,
  client?: Queryable,
): Promise<void> {
  const params = new ParamBuilder();
  const sets: string[] = [];
  if (patch.name !== undefined) sets.push(`name = ${params.add(patch.name)}`);
  if (patch.description !== undefined) sets.push(`description = ${params.add(patch.description)}`);
  if (patch.status !== undefined) sets.push(`status = ${params.add(patch.status)}`);
  if (patch.version !== undefined) sets.push(`version = ${params.add(patch.version)}`);
  // jsonb is passed as text and cast so the driver never turns an array into a
  // PostgreSQL array literal.
  if (patch.definition !== undefined) sets.push(`definition = ${params.add(JSON.stringify(patch.definition))}::jsonb`);
  if (sets.length === 0) return;

  await query(
    `UPDATE workflows SET ${sets.join(", ")} WHERE workspace_id = ${params.add(workspaceId)} AND id = ${params.add(workflowId)}`,
    params.values,
    client,
  );
}

export async function deleteWorkflowRow(workspaceId: string, workflowId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    "DELETE FROM workflows WHERE workspace_id = $1 AND id = $2 RETURNING id",
    [workspaceId, workflowId],
  );
  return rows.length > 0;
}
