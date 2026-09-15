import type { ConversationChannel, ConversationStatus } from "@/features/conversations/types";

/**
 * Client-safe contracts for Conversation Intelligence.
 *
 * Every date is an ISO string. Vectors never appear here: a centroid is an
 * implementation detail of clustering and has no business crossing to a
 * browser, so the server-side row types keep them and these do not.
 */

/**
 * How a conversation ended, derived from the thread rather than set by anyone.
 *
 * Read in priority order, which is how `deriveOutcome` evaluates it: a human
 * reply is the strongest fact available, because it means the assistant did
 * not finish the job regardless of what the status column says afterwards.
 */
export const CONVERSATION_OUTCOMES = ["contained", "handed_off", "escalated", "unresolved"] as const;
export type ConversationOutcome = (typeof CONVERSATION_OUTCOMES)[number];

export const ANALYSIS_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export type AnalysisRunStatus = (typeof ANALYSIS_RUN_STATUSES)[number];

/** One analyzed conversation. */
export interface ConversationInsight {
  id: string;
  conversationId: string;
  topicId: string | null;
  question: string;
  outcome: ConversationOutcome;
  grounded: boolean;
  userMessageCount: number;
  sourceCount: number;
  topicSimilarity: number | null;
  /** When the conversation happened, not when the analysis ran. */
  conversationAt: string;
  analyzedAt: string;
}

/** An insight joined to the conversation it describes, for the topic detail. */
export interface TopicConversation extends ConversationInsight {
  title: string | null;
  status: ConversationStatus;
  channel: ConversationChannel;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

/**
 * A cluster of conversations that asked about the same thing.
 *
 * The counts are stored; every rate is derived from them in `metrics.ts` and
 * never persisted, so there is exactly one definition of "containment rate"
 * and it cannot drift from the counters it is computed from.
 */
export interface TopicSummary {
  id: string;
  label: string;
  summary: string | null;
  conversationCount: number;
  containedCount: number;
  groundedCount: number;
  escalatedCount: number;
  /** Null until the topic has been labelled by a run. */
  labeledAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  updatedAt: string;
}

export interface Topic extends TopicSummary {
  workspaceId: string;
  /** Representative questions, most recent first. Never the whole cluster. */
  examples: string[];
}

/** Workspace-level rollup shown above the topic list. */
export interface IntelligenceOverview {
  conversationsAnalyzed: number;
  topicCount: number;
  containedCount: number;
  groundedCount: number;
  escalatedCount: number;
  handedOffCount: number;
  /** Topics whose coverage is below the gap threshold, by descending volume. */
  gapTopicCount: number;
  windowStart: string | null;
  windowEnd: string | null;
}

export interface AnalysisRun {
  id: string;
  status: AnalysisRunStatus;
  windowStart: string | null;
  windowEnd: string | null;
  conversationsAnalyzed: number;
  topicsCreated: number;
  topicsLabeled: number;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * Everything the Intelligence page needs in one server read.
 *
 * `runs` rather than just the latest: the page shows the most recent run's
 * status in its header and the history below it, and reading them separately
 * would let the two disagree about which run is current.
 */
export interface IntelligenceDashboard {
  overview: IntelligenceOverview;
  topics: TopicSummary[];
  runs: AnalysisRun[];
}

export interface TopicListFilters {
  search?: string;
  /** Only topics whose grounded coverage is below the gap threshold. */
  gapsOnly?: boolean;
  sort: TopicSort;
  page: number;
  pageSize: number;
}

export const TOPIC_SORTS = ["volume", "gap", "recent"] as const;
export type TopicSort = (typeof TOPIC_SORTS)[number];

/** Result of drafting an article from a topic's questions. */
export interface TopicArticleDraft {
  topicId: string;
  title: string;
  content: string;
  /** Set when the draft was filed into the knowledge base. */
  knowledgeSourceId: string | null;
}
