import "server-only";

import { and, count, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";

import { coerceDefinition, type WorkflowDefinition } from "@/features/workflows/domain/definition";
import type { Workflow, WorkflowListFilters, WorkflowRunStatus, WorkflowStatus, WorkflowSummary } from "@/features/workflows/types";
import { withDb, type Database, type DatabaseClient } from "@/server/db/client";
import { workflowRuns, workflows } from "@/server/db/schema";
import { likePattern, normalizePage, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

interface WorkflowRow {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  definition: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  runCount: number;
  lastRunAt: Date | null;
  lastRunStatus: WorkflowRunStatus | null;
}

/**
 * The last run is joined laterally so lists show run health without an N+1
 * query. Both sides of the join filter `workspace_id` explicitly, matching the
 * RLS policy rather than relying on it.
 *
 * Built per call because the lateral subquery is correlated to the outer
 * `workflows` row and therefore has to be constructed against a live handle.
 */
function selectWorkflow(db: Database) {
  const lastRun = db
    .select({ status: workflowRuns.status, createdAt: workflowRuns.createdAt })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.workflowId, workflows.id), eq(workflowRuns.workspaceId, workflows.workspaceId)))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(1)
    .as("last_run");

  return db
    .select({
      id: workflows.id,
      workspaceId: workflows.workspaceId,
      name: workflows.name,
      description: workflows.description,
      status: workflows.status,
      definition: workflows.definition,
      version: workflows.version,
      createdAt: workflows.createdAt,
      updatedAt: workflows.updatedAt,
      // Composed, not templated. Drizzle only qualifies an interpolated column
      // with its table name when the query has a join; this one does, but that
      // makes the correlation quietly dependent on the lateral join above
      // staying put. Composed this way it is qualified either way.
      runCount: sql<number>`${db
        .select({ c: sql`count(*)` })
        .from(workflowRuns)
        .where(and(eq(workflowRuns.workflowId, workflows.id), eq(workflowRuns.workspaceId, workflows.workspaceId)))}`.mapWith(
        Number,
      ),
      lastRunAt: lastRun.createdAt,
      lastRunStatus: lastRun.status,
    })
    .from(workflows)
    .leftJoinLateral(lastRun, sql`true`);
}

function mapWorkflow(row: WorkflowRow): Workflow {
  const definition = coerceDefinition(row.definition);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    status: row.status,
    version: row.version,
    definition,
    stepCount: definition.nodes.length,
    runCount: Number(row.runCount ?? 0),
    lastRunAt: toIso(row.lastRunAt),
    lastRunStatus: row.lastRunStatus,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
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

  // One condition list feeds both the page query and the count, so the two
  // cannot drift the way the old positional-parameter slicing allowed.
  const conditions: Array<SQL | undefined> = [
    eq(workflows.workspaceId, workspaceId),
    filters.status ? eq(workflows.status, filters.status) : ne(workflows.status, "archived"),
  ];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conditions.push(or(ilike(workflows.name, pattern), ilike(workflows.description, pattern)));
  }
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    withDb((db) => selectWorkflow(db).where(where).orderBy(desc(workflows.updatedAt)).limit(page.pageSize).offset(page.offset)),
    withDb((db) => db.select({ total: count() }).from(workflows).where(where)),
  ]);

  return toPaginated(rows.map(mapWorkflow).map(toWorkflowSummary), totals[0]?.total ?? 0, page);
}

export async function findWorkflowById(workspaceId: string, workflowId: string, client?: DatabaseClient): Promise<Workflow | null> {
  const rows = await withDb(
    (db) => selectWorkflow(db).where(and(eq(workflows.workspaceId, workspaceId), eq(workflows.id, workflowId))).limit(1),
    client,
  );
  return rows[0] ? mapWorkflow(rows[0]) : null;
}

export interface InsertWorkflowInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  description: string | null;
  definition: WorkflowDefinition;
}

export async function insertWorkflow(input: InsertWorkflowInput, client?: DatabaseClient): Promise<Workflow> {
  const inserted = await withDb(
    (db) =>
      db
        .insert(workflows)
        .values({
          workspaceId: input.workspaceId,
          createdBy: input.createdBy,
          name: input.name,
          description: input.description,
          definition: input.definition,
        })
        .returning({ id: workflows.id }),
    client,
  );
  const id = inserted[0]?.id;
  if (!id) throw new Error("Failed to insert workflow");
  const workflow = await findWorkflowById(input.workspaceId, id, client);
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
  client?: DatabaseClient,
): Promise<void> {
  // Only the keys actually present are written, so an absent field is left
  // alone rather than overwritten. `updated_at` stays with its trigger.
  const values: Partial<typeof workflows.$inferInsert> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.version !== undefined) values.version = patch.version;
  if (patch.definition !== undefined) values.definition = patch.definition;
  if (Object.keys(values).length === 0) return;

  await withDb(
    (db) => db.update(workflows).set(values).where(and(eq(workflows.workspaceId, workspaceId), eq(workflows.id, workflowId))),
    client,
  );
}

export async function deleteWorkflowRow(workspaceId: string, workflowId: string): Promise<boolean> {
  const rows = await withDb((db) =>
    db
      .delete(workflows)
      .where(and(eq(workflows.workspaceId, workspaceId), eq(workflows.id, workflowId)))
      .returning({ id: workflows.id }),
  );
  return rows.length > 0;
}
