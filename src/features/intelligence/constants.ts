import type { BadgeTone } from "@/components/ui/app-badge";
import type { AnalysisRunStatus, ConversationOutcome, TopicSort } from "@/features/intelligence/types";

export const OUTCOME_META: Record<ConversationOutcome, { label: string; tone: BadgeTone; description: string }> = {
  contained: { label: "Contained", tone: "success", description: "Resolved without a person stepping in." },
  handed_off: { label: "Handed off", tone: "warning", description: "A team member replied in the thread." },
  escalated: { label: "Escalated", tone: "danger", description: "Marked for a person and not yet answered." },
  unresolved: { label: "Unresolved", tone: "neutral", description: "Still open, with nobody assigned to it." },
};

/** Priority order used by the rollup bar and the outcome legend. */
export const OUTCOME_ORDER: ReadonlyArray<ConversationOutcome> = [
  "contained",
  "handed_off",
  "escalated",
  "unresolved",
];

export const RUN_STATUS_META: Record<AnalysisRunStatus, { label: string; tone: BadgeTone }> = {
  running: { label: "Analyzing", tone: "info" },
  succeeded: { label: "Up to date", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export const TOPIC_SORT_LABELS: Record<TopicSort, string> = {
  volume: "Most conversations",
  gap: "Biggest knowledge gap",
  recent: "Most recent",
};

/* -------------------------------------------------------------------------- */
/* Clustering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Cosine similarity a question must reach to join an existing topic.
 *
 * TUNED FOR THE MOCK EMBEDDING PROVIDER, WHICH IS LEXICAL, NOT SEMANTIC.
 * `MockEmbeddingProvider` is a feature-hashing encoder, so similarity here is
 * shared vocabulary and nothing more. Measured over the seeded demo questions:
 *
 *   same subject, different wording   median 0.158, max 0.516
 *   different subjects                median 0.000, max 0.154
 *
 * The two distributions barely separate, and they overlap: "We need SSO before
 * we can roll this out" and "Is single sign on supported anywhere" share no
 * content word at all and score 0.000. No threshold groups those, because the
 * encoder cannot see that they are the same question.
 *
 * 0.3 is the measured best of a bad set of options - it clears the 0.154 ceiling
 * on unrelated pairs with margin, and leader clustering then does better than
 * the pairwise numbers suggest because a growing centroid accumulates the
 * subject's vocabulary. Over the 31 seeded conversations it yields 14 topics
 * with 2 partly-mixed; 0.25 gives 11 with a worse mix, 0.2 fuses SSO with
 * refunds, and 0.6 - the first guess - grouped nothing at all and left 27
 * topics for 31 conversations.
 *
 * THIS NUMBER MUST BE RE-MEASURED WHEN A HOSTED EMBEDDING PROVIDER IS WIRED IN,
 * and it will be much higher: a real model puts paraphrases near 0.85+. It is
 * not a preference, it is a property of the vector space - which is also why
 * `conversation_topics.embedding_config` exists, so a centroid built under one
 * provider is never compared against vectors from another.
 */
export const TOPIC_SIMILARITY_THRESHOLD = 0.3;

/**
 * Upper bound on topics per workspace.
 *
 * Every conversation is compared against every centroid, so this caps the
 * clustering pass at `conversations x MAX_TOPICS` dot products. Once reached,
 * a question that matches nothing joins its nearest topic anyway rather than
 * founding an unbounded tail of singletons - a slightly wrong topic is more
 * useful than five hundred topics of one.
 */
export const MAX_TOPICS_PER_WORKSPACE = 200;

/** Conversations one run will analyze, so a busy workspace stays bounded. */
export const MAX_CONVERSATIONS_PER_RUN = 2_000;

/** How far back a run looks when no window is given. */
export const DEFAULT_ANALYSIS_WINDOW_DAYS = 30;
export const MAX_ANALYSIS_WINDOW_DAYS = 365;

/** Questions longer than this are clipped before embedding. */
export const MAX_QUESTION_CHARS = 1_000;

/* -------------------------------------------------------------------------- */
/* Knowledge gaps                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A topic is a "gap" when at most this share of its conversations were answered
 * with a citation from the knowledge base.
 *
 * Grounding is the signal because it is the one the pipeline records honestly:
 * `messages.sources` is written by retrieval, not inferred afterwards. A reply
 * with no sources is one the model produced from its own weights, which is
 * precisely the answer nobody can verify and nobody can correct.
 */
export const KNOWLEDGE_GAP_COVERAGE_THRESHOLD = 0.5;

/** Below this many conversations a topic is too small to call a gap. */
export const KNOWLEDGE_GAP_MIN_CONVERSATIONS = 3;

/* -------------------------------------------------------------------------- */
/* Labelling and drafting                                                      */
/* -------------------------------------------------------------------------- */

/** Questions sent to the model when naming a topic. */
export const LABEL_MAX_QUESTIONS = 12;
export const LABEL_MAX_OUTPUT_TOKENS = 160;
export const MAX_TOPIC_LABEL_CHARS = 80;
export const MAX_TOPIC_SUMMARY_CHARS = 400;

/**
 * Topics relabelled per run, newest and largest first.
 *
 * One model call each, so this is the cost ceiling of a run. A topic that does
 * not fit keeps its current label and is picked up by the next run.
 */
export const MAX_TOPICS_LABELED_PER_RUN = 25;

/**
 * Relabel once a topic has grown by this factor since its label was written.
 * A topic that has doubled is usually about something broader than the handful
 * of questions that named it.
 */
export const RELABEL_GROWTH_FACTOR = 2;

/** Questions shown as examples on a topic. */
export const TOPIC_EXAMPLE_LIMIT = 8;

/** Questions fed to the article drafter. */
export const DRAFT_MAX_QUESTIONS = 40;
export const DRAFT_MAX_OUTPUT_TOKENS = 1_200;
export const MAX_ARTICLE_CHARS = 12_000;
