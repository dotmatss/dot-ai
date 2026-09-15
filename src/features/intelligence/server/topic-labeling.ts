import "server-only";

import {
  LABEL_MAX_OUTPUT_TOKENS,
  LABEL_MAX_QUESTIONS,
  MAX_TOPICS_LABELED_PER_RUN,
  MAX_TOPIC_LABEL_CHARS,
  MAX_TOPIC_SUMMARY_CHARS,
  RELABEL_GROWTH_FACTOR,
} from "@/features/intelligence/constants";
import { buildLabelPrompt, deriveFallbackLabel, LABEL_SYSTEM_PROMPT, parseLabelReply } from "@/features/intelligence/label-prompt";
import {
  listRelabelCandidates,
  listTopicQuestions,
  updateTopicRow,
} from "@/features/intelligence/server/intelligence-repository";
import { getAiGateway } from "@/server/ai";
import { withWorkspace } from "@/server/db/client";
import type { ChatMessage } from "@/types/ai";

/**
 * Names topics from the questions inside them.
 *
 * Phase 3 of a run, and the only phase that costs anything per topic. It is
 * bounded by `MAX_TOPICS_LABELED_PER_RUN` rather than by the number of topics,
 * so the cost of a run is a constant a customer can be quoted. Topics that do
 * not fit keep the name they have and are picked up by the next run.
 */

export interface LabelTopicsOptions {
  workspaceId: string;
  signal?: AbortSignal;
}

export interface LabelingResult {
  labeled: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Topics labelled at once.
 *
 * The calls are independent, and doing them one after another makes the wall
 * time of a run the sum of every model latency - twenty-five sequential calls
 * is a minute of somebody watching a spinner. Bounded rather than unbounded
 * because the gateway is shared with live chat traffic, and a background
 * analysis must not be able to spend the whole connection budget.
 */
const LABEL_CONCURRENCY = 4;

export async function labelTopics(options: LabelTopicsOptions): Promise<LabelingResult> {
  const candidates = await listRelabelCandidates(
    options.workspaceId,
    RELABEL_GROWTH_FACTOR,
    MAX_TOPICS_LABELED_PER_RUN,
  );
  if (candidates.length === 0) return { labeled: 0, tokensIn: 0, tokensOut: 0 };

  let labeled = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  const queue = [...candidates];
  const workers = Array.from({ length: Math.min(LABEL_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const candidate = queue.shift();
      if (!candidate) return;
      const result = await labelOne(options, candidate);
      if (!result) continue;
      labeled += 1;
      tokensIn += result.tokensIn;
      tokensOut += result.tokensOut;
    }
  });
  await Promise.all(workers);

  return { labeled, tokensIn, tokensOut };
}

/** Labels one topic, or returns null if it could not be labelled. */
async function labelOne(
  options: LabelTopicsOptions,
  candidate: { id: string; conversationCount: number },
): Promise<{ tokensIn: number; tokensOut: number } | null> {
  const questions = await listTopicQuestions(options.workspaceId, candidate.id, LABEL_MAX_QUESTIONS);
  if (questions.length === 0) return null;

  // One topic failing to label must not abandon the rest, and must not fail the
  // run: the analysis itself has already succeeded by this point, and a topic
  // keeping a derived name is a much smaller loss than throwing away every
  // insight that was just computed.
  let result: LabelRequestResult | null = null;
  try {
    result = await requestLabel(questions, options.signal);
  } catch {
    result = null;
  }
  if (!result) return null;

  const parsed = parseLabelReply(result.text);
  // A reply the parser did not recognize still counts as labelled: the topic
  // gets a name derived from its own questions, and `labeled_size` advances so
  // the next run does not immediately retry the same unparseable topic.
  const label = (parsed.label ?? deriveFallbackLabel(questions)).slice(0, MAX_TOPIC_LABEL_CHARS);
  const summary = parsed.summary ? parsed.summary.slice(0, MAX_TOPIC_SUMMARY_CHARS) : null;

  await withWorkspace(options.workspaceId, (client) =>
    updateTopicRow(
      options.workspaceId,
      candidate.id,
      {
        label,
        // Only overwrite a summary with a real one. Clearing a good summary
        // because this reply lacked the line would be a silent regression.
        ...(summary ? { summary } : {}),
        labeledAt: new Date(),
        labeledSize: candidate.conversationCount,
      },
      client,
    ),
  );

  return { tokensIn: result.tokensIn, tokensOut: result.tokensOut };
}

interface LabelRequestResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * One model call, collected rather than streamed.
 *
 * The output is a stored field, not something anyone watches arrive, so the
 * stream is drained here and the row is written once it finishes cleanly -
 * the same reasoning `generateContactSummary` follows.
 */
async function requestLabel(questions: string[], signal?: AbortSignal): Promise<LabelRequestResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: LABEL_SYSTEM_PROMPT },
    { role: "user", content: buildLabelPrompt(questions) },
  ];

  const gateway = getAiGateway();
  let text = "";
  let tokensIn = 0;
  let tokensOut = 0;

  for await (const event of gateway.streamChat({
    messages,
    temperature: 0.1,
    maxTokens: LABEL_MAX_OUTPUT_TOKENS,
    metadata: { feature: "intelligence_topic_label" },
    signal,
  })) {
    if (event.type === "text-delta") text += event.delta;
    else if (event.type === "usage") {
      tokensIn = event.usage.inputTokens;
      tokensOut = event.usage.outputTokens;
    } else if (event.type === "error") {
      throw new Error(event.message);
    }
  }

  return { text, tokensIn, tokensOut };
}
