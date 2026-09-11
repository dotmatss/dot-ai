import type { CreateChatbotInput, UpdateChatbotInput } from "@/features/chatbots/schemas";
import type { Chatbot, ChatbotKnowledgeOption, ChatbotListFilters, ChatbotOverview, ChatbotSummary } from "@/features/chatbots/types";
import { apiFetch, buildQueryString } from "@/lib/api/http";
import type { Paginated } from "@/types/pagination";

const base = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/chatbots`;

/** Client-side API surface for the chatbots domain. */
export const chatbotsApi = {
  list: (workspaceSlug: string, filters: ChatbotListFilters = {}) =>
    apiFetch<Paginated<ChatbotSummary>>(`${base(workspaceSlug)}${buildQueryString(filters)}`),
  get: (workspaceSlug: string, chatbotId: string) => apiFetch<Chatbot>(`${base(workspaceSlug)}/${chatbotId}`),
  create: (workspaceSlug: string, input: CreateChatbotInput) =>
    apiFetch<Chatbot>(base(workspaceSlug), { method: "POST", json: input }),
  update: (workspaceSlug: string, chatbotId: string, input: UpdateChatbotInput) =>
    apiFetch<Chatbot>(`${base(workspaceSlug)}/${chatbotId}`, { method: "PATCH", json: input }),
  remove: (workspaceSlug: string, chatbotId: string) =>
    apiFetch<void>(`${base(workspaceSlug)}/${chatbotId}`, { method: "DELETE" }),
  knowledgeOptions: (workspaceSlug: string, chatbotId: string) =>
    apiFetch<ChatbotKnowledgeOption[]>(`${base(workspaceSlug)}/${chatbotId}/knowledge`),
  overview: (workspaceSlug: string, chatbotId: string) =>
    apiFetch<ChatbotOverview>(`${base(workspaceSlug)}/${chatbotId}/overview`),
  chatUrl: (workspaceSlug: string, chatbotId: string) => `${base(workspaceSlug)}/${chatbotId}/chat`,
};
