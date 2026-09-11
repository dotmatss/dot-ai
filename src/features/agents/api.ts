import type { CreateAgentInput, UpdateAgentInput } from "@/features/agents/schemas";
import type { Agent, AgentKnowledgeOption, AgentListFilters, AgentOverview, AgentSummary } from "@/features/agents/types";
import { apiFetch, buildQueryString } from "@/lib/api/http";
import type { Paginated } from "@/types/pagination";

const base = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/agents`;

/** Client-side API surface for the agents domain. */
export const agentsApi = {
  list: (workspaceSlug: string, filters: AgentListFilters = {}) =>
    apiFetch<Paginated<AgentSummary>>(`${base(workspaceSlug)}${buildQueryString(filters)}`),
  get: (workspaceSlug: string, agentId: string) => apiFetch<Agent>(`${base(workspaceSlug)}/${agentId}`),
  create: (workspaceSlug: string, input: CreateAgentInput) => apiFetch<Agent>(base(workspaceSlug), { method: "POST", json: input }),
  update: (workspaceSlug: string, agentId: string, input: UpdateAgentInput) =>
    apiFetch<Agent>(`${base(workspaceSlug)}/${agentId}`, { method: "PATCH", json: input }),
  remove: (workspaceSlug: string, agentId: string) => apiFetch<void>(`${base(workspaceSlug)}/${agentId}`, { method: "DELETE" }),
  knowledgeOptions: (workspaceSlug: string, agentId: string) =>
    apiFetch<AgentKnowledgeOption[]>(`${base(workspaceSlug)}/${agentId}/knowledge`),
  overview: (workspaceSlug: string, agentId: string) => apiFetch<AgentOverview>(`${base(workspaceSlug)}/${agentId}/overview`),
  chatUrl: (workspaceSlug: string, agentId: string) => `${base(workspaceSlug)}/${agentId}/chat`,
};
