import "server-only";

import { definitionErrors, validateDefinition, type WorkflowDefinition } from "@/features/workflows/domain/definition";
import { templateDefinition } from "@/features/workflows/domain/templates";
import type { CreateWorkflowInput, updateWorkflowSchema } from "@/features/workflows/schemas";
import {
  deleteWorkflowRow,
  findWorkflowById,
  insertWorkflow,
  listWorkflows,
  updateWorkflowRow,
  type WorkflowPatch,
} from "@/features/workflows/server/workflow-repository";
import { findWorkflowRunById, listWorkflowRuns } from "@/features/workflows/server/workflow-run-repository";
import type {
  Workflow,
  WorkflowListFilters,
  WorkflowRun,
  WorkflowRunListFilters,
  WorkflowRunSummary,
  WorkflowSummary,
} from "@/features/workflows/types";
import { ApiError } from "@/lib/api/api-error";
import { recordActivity } from "@/server/activity/activity-log";
import { withWorkspace } from "@/server/db/client";
import type { Paginated } from "@/types/pagination";
import type { z } from "zod";

export interface ActorContext {
  workspaceId: string;
  userId: string;
}

type UpdateInput = z.output<typeof updateWorkflowSchema>;

export function getWorkflows(workspaceId: string, filters: WorkflowListFilters): Promise<Paginated<WorkflowSummary>> {
  return listWorkflows(workspaceId, filters);
}

export async function getWorkflow(workspaceId: string, workflowId: string): Promise<Workflow> {
  const workflow = await findWorkflowById(workspaceId, workflowId);
  if (!workflow) throw ApiError.notFound("Workflow not found");
  return workflow;
}

export async function getWorkflowRuns(
  workspaceId: string,
  workflowId: string,
  filters: WorkflowRunListFilters,
): Promise<Paginated<WorkflowRunSummary>> {
  // Resolving the workflow first keeps a run list for another tenant's id a 404.
  await getWorkflow(workspaceId, workflowId);
  return listWorkflowRuns(workspaceId, workflowId, filters);
}

export async function getWorkflowRun(workspaceId: string, workflowId: string, runId: string): Promise<WorkflowRun> {
  const run = await findWorkflowRunById(workspaceId, workflowId, runId);
  if (!run) throw ApiError.notFound("Run not found");
  return run;
}

export async function createWorkflow(ctx: ActorContext, input: CreateWorkflowInput): Promise<Workflow> {
  const definition = templateDefinition(input.template ?? "blank");
  return withWorkspace(ctx.workspaceId, async (client) => {
    const workflow = await insertWorkflow(
      {
        workspaceId: ctx.workspaceId,
        createdBy: ctx.userId,
        name: input.name.trim(),
        description: input.description?.trim() ? input.description.trim() : null,
        definition,
      },
      client,
    );
    await recordActivity(
      {
        workspaceId: ctx.workspaceId,
        actorId: ctx.userId,
        entityType: "workflow",
        entityId: workflow.id,
        action: "created",
        summary: `Created workflow “${workflow.name}”`,
        metadata: { template: input.template ?? "blank" },
      },
      client,
    );
    return workflow;
  });
}

/**
 * A definition may be saved while it still has problems (drafts are
 * work-in-progress), but a workflow can only be active when it validates:
 * live triggers must never start a run that cannot finish.
 */
function assertActivatable(status: string, definition: WorkflowDefinition, field: "status" | "definition"): void {
  if (status !== "active") return;
  const errors = definitionErrors(validateDefinition(definition));
  const first = errors[0];
  if (first) {
    throw ApiError.validation({ [field]: [`Fix the workflow before activating it: ${first.message}`] });
  }
}

export async function updateWorkflow(ctx: ActorContext, workflowId: string, input: UpdateInput): Promise<Workflow> {
  return withWorkspace(ctx.workspaceId, async (client) => {
    const existing = await findWorkflowById(ctx.workspaceId, workflowId, client);
    if (!existing) throw ApiError.notFound("Workflow not found");

    const effectiveDefinition = input.definition ?? existing.definition;
    const effectiveStatus = input.status ?? existing.status;
    assertActivatable(effectiveStatus, effectiveDefinition, input.definition ? "definition" : "status");

    const definitionChanged =
      input.definition !== undefined && JSON.stringify(input.definition) !== JSON.stringify(existing.definition);

    const patch: WorkflowPatch = {
      name: input.name,
      description:
        input.description === undefined ? undefined : input.description?.trim() ? input.description.trim() : null,
      status: input.status,
      definition: definitionChanged ? input.definition : undefined,
      // The version is the builder's optimistic-concurrency signal and its
      // audit trail: every saved definition is a new version.
      version: definitionChanged ? existing.version + 1 : undefined,
    };
    await updateWorkflowRow(ctx.workspaceId, workflowId, patch, client);

    const updated = await findWorkflowById(ctx.workspaceId, workflowId, client);
    if (!updated) throw ApiError.notFound("Workflow not found");

    if (input.status && input.status !== existing.status) {
      await recordActivity(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.userId,
          entityType: "workflow",
          entityId: workflowId,
          action: `status:${input.status}`,
          summary: `Set workflow “${updated.name}” to ${input.status}`,
        },
        client,
      );
    } else if (definitionChanged) {
      await recordActivity(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.userId,
          entityType: "workflow",
          entityId: workflowId,
          action: "definition:saved",
          summary: `Saved version ${updated.version} of workflow “${updated.name}”`,
          metadata: { steps: updated.stepCount, version: updated.version },
        },
        client,
      );
    } else {
      await recordActivity(
        {
          workspaceId: ctx.workspaceId,
          actorId: ctx.userId,
          entityType: "workflow",
          entityId: workflowId,
          action: "updated",
          summary: `Updated workflow “${updated.name}”`,
          metadata: { fields: Object.keys(input) },
        },
        client,
      );
    }

    return updated;
  });
}

export async function deleteWorkflow(ctx: ActorContext, workflowId: string): Promise<void> {
  const existing = await findWorkflowById(ctx.workspaceId, workflowId);
  if (!existing) throw ApiError.notFound("Workflow not found");
  await deleteWorkflowRow(ctx.workspaceId, workflowId);
  await recordActivity({
    workspaceId: ctx.workspaceId,
    actorId: ctx.userId,
    entityType: "workflow",
    entityId: workflowId,
    action: "deleted",
    summary: `Deleted workflow “${existing.name}”`,
  });
}
