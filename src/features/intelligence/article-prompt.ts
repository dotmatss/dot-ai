import { DRAFT_MAX_QUESTIONS, MAX_ARTICLE_CHARS, MAX_QUESTION_CHARS } from "@/features/intelligence/constants";

/**
 * Drafting a knowledge article from the questions a topic collected.
 *
 * This is the payoff of the whole feature: a topic with poor coverage is a list
 * of questions nobody has written an answer to, and this turns that list into
 * the first draft of the answer.
 *
 * WHAT THE PROMPT REFUSES TO DO, AND WHY
 * --------------------------------------
 * The model has the questions and nothing else. It does not have the answers,
 * and it must not supply them from its own weights: an article invented here
 * goes into the knowledge base, gets retrieved, and is then cited to a customer
 * as though somebody had written it. That is worse than the gap it was meant to
 * fill, because an ungrounded answer in a transcript is at least visible as
 * ungrounded, while an invented knowledge source launders itself into a
 * citation.
 *
 * So the draft is a STRUCTURE with the answers left blank and marked. A person
 * fills them in. That is also why the draft is filed as Unorganized by default:
 * the knowledge feature treats unorganized sources as unreachable by any agent,
 * so a half-written article cannot be retrieved until somebody files it.
 */

export const ARTICLE_SYSTEM_PROMPT = `You draft the skeleton of a support knowledge-base article from real customer questions.

You are given the questions only. You do NOT have the answers, and you must not invent them.

Write:
- A title line: a short noun phrase naming the subject.
- A one-paragraph scope note: who asks this and what they are trying to do.
- A list of the distinct questions to answer, deduplicated and rewritten in clear, neutral wording.
- Under each question, the single line: ANSWER NEEDED - <what a correct answer has to state>

Rules:
- Never state a fact about the product, pricing, timing, limits or policy. You do not know any.
- If several questions are the same question, merge them and say how many people asked.
- Plain markdown: a heading, short paragraphs, and lists. No preamble, no closing remarks.`;

function clip(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export interface ArticlePromptInput {
  topicLabel: string;
  topicSummary: string | null;
  questions: ReadonlyArray<string>;
  /** Conversations in the topic that got no knowledge citation. */
  ungroundedCount: number;
  conversationCount: number;
}

export function buildArticlePrompt(input: ArticlePromptInput): string {
  const header = [
    `Topic: ${input.topicLabel}`,
    input.topicSummary ? `What we know about it: ${input.topicSummary}` : null,
    `Volume: ${input.conversationCount} conversation${input.conversationCount === 1 ? "" : "s"}, of which ${input.ungroundedCount} were answered with no supporting document.`,
  ]
    .filter(Boolean)
    .join("\n");

  const questions = input.questions
    .slice(0, DRAFT_MAX_QUESTIONS)
    .map((question) => `- ${clip(question, MAX_QUESTION_CHARS)}`)
    .join("\n");

  return `${header}\n\nThe questions people actually asked:\n${questions}`;
}

/**
 * Derives the stored source name from the drafted article.
 *
 * The model was asked for a title line; a reply that does not lead with a
 * heading falls back to the topic label, because a knowledge source with a
 * blank name is unusable in the list it has to appear in.
 */
export function deriveArticleTitle(article: string, topicLabel: string): string {
  const firstLine = article
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) return topicLabel;
  const heading = firstLine.replace(/^#+\s*/, "").replace(/^["'*_\s]+|["'*_\s]+$/g, "");
  // A "title" longer than a sentence is the model having written a paragraph;
  // the label is a better name than an essay's first 120 characters.
  if (!heading || heading.length > 120) return topicLabel;
  return heading;
}

/** Hard cap on what is stored, independent of what the model returned. */
export function clampArticle(article: string): string {
  return article.trim().slice(0, MAX_ARTICLE_CHARS);
}
