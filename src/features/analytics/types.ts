/**
 * Client-safe contracts for the analytics feature. Dates are ISO strings so
 * every shape can cross the Server → Client Component boundary unchanged.
 */

export const ANALYTICS_PERIODS = ["7d", "30d", "90d"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

/** Time-series granularity; short periods use days, long periods use weeks. */
export type AnalyticsBucket = "day" | "week";

/** A metric measured in the selected period and in the previous period of equal length. */
export interface MetricComparison {
  current: number;
  previous: number;
}

export interface AnalyticsKpis {
  conversations: MetricComparison;
  visitorMessages: MetricComparison;
  resolvedConversations: MetricComparison;
  /** Tokens in + tokens out from usage_events. */
  tokens: MetricComparison;
  tokensIn: number;
  tokensOut: number;
}

export interface TimeBucket {
  /** ISO timestamp of the bucket start (UTC). */
  start: string;
  value: number;
}

export interface ConversationSeries {
  bucket: AnalyticsBucket;
  current: TimeBucket[];
  /** Same number of buckets as `current`, aligned index-by-index. */
  previous: TimeBucket[];
}

export interface ChatbotMessagesRow {
  /** Null when the conversation had no chatbot (agent / API conversations). */
  chatbotId: string | null;
  name: string;
  messages: number;
}

export interface TokenBucket {
  start: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ChatbotTokenRow {
  chatbotId: string;
  /** Null when the chatbot has since been deleted. */
  name: string | null;
  tokensIn: number;
  tokensOut: number;
}

export interface TokenUsage {
  bucket: AnalyticsBucket;
  series: TokenBucket[];
  byChatbot: ChatbotTokenRow[];
  totalIn: number;
  totalOut: number;
}

export const CONVERSATION_CHANNELS = ["widget", "playground", "api", "agent"] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export interface ChannelCount {
  channel: ConversationChannel;
  count: number;
}

export interface WorkflowRunsSummary {
  total: number;
  succeeded: number;
  failed: number;
  previousTotal: number;
  previousSucceeded: number;
  previousFailed: number;
}

export interface CrmGrowth {
  totalContacts: number;
  newContacts: number;
  previousNewContacts: number;
  bucket: AnalyticsBucket;
  series: TimeBucket[];
}

export const USAGE_KINDS = ["message", "tokens_in", "tokens_out", "workflow_run", "embedding", "retrieval"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export type UsageTotals = Record<UsageKind, number>;
