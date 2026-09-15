import type { DraftArticleInput, RunAnalysisInput, UpdateTopicInput } from "@/features/intelligence/schemas";
import type {
  AnalysisRun,
  IntelligenceOverview,
  Topic,
  TopicArticleDraft,
  TopicConversation,
  TopicListFilters,
  TopicSummary,
} from "@/features/intelligence/types";
import { apiFetch, buildQueryString } from "@/lib/api/http";
import type { Paginated, PaginationParams } from "@/types/pagination";

const base = (workspaceSlug: string) => `/api/v1/w/${workspaceSlug}/intelligence`;
const topic = (workspaceSlug: string, topicId: string) => `${base(workspaceSlug)}/topics/${topicId}`;

/** Client-side API surface for Conversation Intelligence. */
export const intelligenceApi = {
  overview: (workspaceSlug: string) => apiFetch<IntelligenceOverview>(`${base(workspaceSlug)}/overview`),

  listTopics: (workspaceSlug: string, filters: Partial<TopicListFilters> = {}) =>
    apiFetch<Paginated<TopicSummary>>(`${base(workspaceSlug)}/topics${buildQueryString(filters)}`),
  getTopic: (workspaceSlug: string, topicId: string) => apiFetch<Topic>(topic(workspaceSlug, topicId)),
  updateTopic: (workspaceSlug: string, topicId: string, input: UpdateTopicInput) =>
    apiFetch<Topic>(topic(workspaceSlug, topicId), { method: "PATCH", json: input }),

  listTopicConversations: (workspaceSlug: string, topicId: string, params: PaginationParams = {}) =>
    apiFetch<Paginated<TopicConversation>>(`${topic(workspaceSlug, topicId)}/conversations${buildQueryString(params)}`),

  draftArticle: (workspaceSlug: string, topicId: string, input: DraftArticleInput) =>
    apiFetch<TopicArticleDraft>(`${topic(workspaceSlug, topicId)}/article`, { method: "POST", json: input }),

  listRuns: (workspaceSlug: string) => apiFetch<AnalysisRun[]>(`${base(workspaceSlug)}/runs`),
  runAnalysis: (workspaceSlug: string, input: RunAnalysisInput) =>
    apiFetch<AnalysisRun>(`${base(workspaceSlug)}/runs`, { method: "POST", json: input }),
};
