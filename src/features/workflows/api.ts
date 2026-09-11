import type { CreateWorkflowInput, StartWorkflowRunInput, UpdateWorkflowInput } from "@/features/workflows/schemas";
import type {
  Workflow,
  WorkflowListFilters,
  WorkflowRun,
  WorkflowRunListFilters,
  WorkflowRunSummary,
  WorkflowSummary,
} from "@/features/workflows/types";
import { apiFetch, buildQueryString } from "@/lib/api/http";
import type { Paginated } from "@/types/pagination";

const base = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/workflows`;

/** Client-side API surface for the workflows domain. */
export const workflowsApi = {
  list: (workspaceSlug: string, filters: WorkflowListFilters = {}) =>
    apiFetch<Paginated<WorkflowSummary>>(`${base(workspaceSlug)}${buildQueryString(filters)}`),
  get: (workspaceSlug: string, workflowId: string) => apiFetch<Workflow>(`${base(workspaceSlug)}/${workflowId}`),
  create: (workspaceSlug: string, input: CreateWorkflowInput) =>
    apiFetch<Workflow>(base(workspaceSlug), { method: "POST", json: input }),
  update: (workspaceSlug: string, workflowId: string, input: UpdateWorkflowInput) =>
    apiFetch<Workflow>(`${base(workspaceSlug)}/${workflowId}`, { method: "PATCH", json: input }),
  remove: (workspaceSlug: string, workflowId: string) =>
    apiFetch<void>(`${base(workspaceSlug)}/${workflowId}`, { method: "DELETE" }),
  listRuns: (workspaceSlug: string, workflowId: string, filters: WorkflowRunListFilters = {}) =>
    apiFetch<Paginated<WorkflowRunSummary>>(`${base(workspaceSlug)}/${workflowId}/runs${buildQueryString(filters)}`),
  getRun: (workspaceSlug: string, workflowId: string, runId: string) =>
    apiFetch<WorkflowRun>(`${base(workspaceSlug)}/${workflowId}/runs/${runId}`),
  startRun: (workspaceSlug: string, workflowId: string, input: StartWorkflowRunInput) =>
    apiFetch<WorkflowRun>(`${base(workspaceSlug)}/${workflowId}/runs`, { method: "POST", json: input }),
};
