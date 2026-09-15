import {
  KNOWLEDGE_GAP_COVERAGE_THRESHOLD,
  KNOWLEDGE_GAP_MIN_CONVERSATIONS,
} from "@/features/intelligence/constants";
import type { ConversationOutcome, IntelligenceOverview, TopicSummary } from "@/features/intelligence/types";

/**
 * Every rate this feature reports, defined once.
 *
 * Nothing here is persisted. The database stores counts; a rate is always
 * derived, so the number on a topic row and the number in the workspace rollup
 * cannot disagree about what "containment" means. Pure functions, no imports
 * from the server: this module is imported by both.
 */

export interface OutcomeInput {
  /** The status a team member set on the conversation. */
  status: "open" | "resolved" | "escalated";
  /** Replies in the thread written by a team member. */
  humanReplyCount: number;
}

/**
 * Derives how a conversation ended.
 *
 * A HUMAN REPLY OUTRANKS THE STATUS COLUMN, and that ordering is the whole
 * point. A thread where someone stepped in and then marked it resolved is a
 * success for the team and a failure for the assistant; counting it as
 * "contained" because of the status would report the deflection rate as
 * whatever the inbox hygiene happens to be. What the assistant did is a fact
 * about the messages, so it is read from the messages.
 */
export function deriveOutcome(input: OutcomeInput): ConversationOutcome {
  if (input.humanReplyCount > 0) return "handed_off";
  if (input.status === "escalated") return "escalated";
  if (input.status === "resolved") return "contained";
  return "unresolved";
}

/**
 * Whether the assistant answered this thread from the knowledge base.
 *
 * One citation anywhere in the thread is enough. A conversation that starts
 * off-topic and lands on a documented answer is still a documented answer.
 */
export function isGrounded(sourceCount: number): boolean {
  return sourceCount > 0;
}

/** Guarded division: a rate over zero conversations is 0, never NaN. */
export function rate(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, part / total));
}

export function containmentRate(topic: Pick<TopicSummary, "containedCount" | "conversationCount">): number {
  return rate(topic.containedCount, topic.conversationCount);
}

/** Share of the topic's conversations answered with a knowledge citation. */
export function coverageRate(topic: Pick<TopicSummary, "groundedCount" | "conversationCount">): number {
  return rate(topic.groundedCount, topic.conversationCount);
}

export function escalationRate(topic: Pick<TopicSummary, "escalatedCount" | "conversationCount">): number {
  return rate(topic.escalatedCount, topic.conversationCount);
}

/**
 * Whether a topic is a knowledge gap worth acting on.
 *
 * The volume floor is not decoration. Coverage over one conversation is either
 * 0 or 1, so without it every brand-new topic would be reported as a total gap
 * on the strength of a single ungrounded question - and the list of things to
 * write documentation about would be noise.
 */
export function isKnowledgeGap(topic: Pick<TopicSummary, "groundedCount" | "conversationCount">): boolean {
  if (topic.conversationCount < KNOWLEDGE_GAP_MIN_CONVERSATIONS) return false;
  return coverageRate(topic) <= KNOWLEDGE_GAP_COVERAGE_THRESHOLD;
}

/**
 * How much documentation writing this topic is worth, highest first.
 *
 * Volume times the share that went unanswered: fifty conversations at 40%
 * coverage outrank four at 0%, because the point of the ranking is which
 * article to write on Monday morning. Topics under the volume floor score
 * zero rather than being filtered, so a caller can sort without also
 * remembering to exclude them.
 */
export function knowledgeGapScore(topic: Pick<TopicSummary, "groundedCount" | "conversationCount">): number {
  if (topic.conversationCount < KNOWLEDGE_GAP_MIN_CONVERSATIONS) return 0;
  return topic.conversationCount * (1 - coverageRate(topic));
}

/** Workspace containment: conversations the assistant finished on its own. */
export function overviewContainmentRate(overview: Pick<IntelligenceOverview, "containedCount" | "conversationsAnalyzed">): number {
  return rate(overview.containedCount, overview.conversationsAnalyzed);
}

export function overviewCoverageRate(overview: Pick<IntelligenceOverview, "groundedCount" | "conversationsAnalyzed">): number {
  return rate(overview.groundedCount, overview.conversationsAnalyzed);
}

/** `0.5732` → `"57%"`. Percentages are display-only and never stored. */
export function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}
