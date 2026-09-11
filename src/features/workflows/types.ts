import type { WorkflowDefinition } from "@/features/workflows/domain/definition";
import type { WorkflowNodeType } from "@/features/workflows/domain/node-types";

/**
 * Client-safe workflow contracts. Everything crossing the server/client
 * boundary is serializable: timestamps are ISO strings and jsonb payloads are
 * plain records.
 */

export const WORKFLOW_STATUSES = ["draft", "active", "paused", "archived"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WORKFLOW_RUN_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled", "waiting_approval"] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_STEP_STATUSES = ["succeeded", "failed", "skipped"] as const;
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

export const WORKFLOW_TRIGGER_KINDS = ["manual", "webhook", "conversation", "api", "schedule"] as const;
export type WorkflowTriggerKind = (typeof WORKFLOW_TRIGGER_KINDS)[number];

/** One entry of `workflow_runs.steps` (jsonb). */
export interface WorkflowRunStep {
  nodeId: string;
  type: WorkflowNodeType;
  label: string;
  status: WorkflowStepStatus;
  startedAt: string;
  finishedAt: string;
  output: Record<string, unknown> | null;
  error: string | null;
}

/** How a run was started; never carries internal identifiers. */
export interface WorkflowRunTrigger {
  kind: WorkflowTriggerKind;
  label: string | null;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  version: number;
  stepCount: number;
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: WorkflowRunStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface Workflow extends WorkflowSummary {
  workspaceId: string;
  definition: WorkflowDefinition;
}

export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  trigger: WorkflowRunTrigger;
  stepCount: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface WorkflowRun extends WorkflowRunSummary {
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  steps: WorkflowRunStep[];
}

export interface WorkflowListFilters {
  q?: string;
  status?: WorkflowStatus;
  page?: number;
  pageSize?: number;
}

export interface WorkflowRunListFilters {
  status?: WorkflowRunStatus;
  page?: number;
  pageSize?: number;
}

/** Milliseconds a run or step took, or null while it is still open. */
export function durationMs(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const elapsed = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}
