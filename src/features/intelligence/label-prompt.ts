import {
  LABEL_MAX_QUESTIONS,
  MAX_QUESTION_CHARS,
  MAX_TOPIC_LABEL_CHARS,
  MAX_TOPIC_SUMMARY_CHARS,
} from "@/features/intelligence/constants";

/**
 * Naming a topic from the questions inside it.
 *
 * Pure: builds a prompt, parses a reply. No gateway, no database, so the
 * parsing rules - which are the part that actually breaks - are testable
 * without either.
 */

export const LABEL_SYSTEM_PROMPT = `You name clusters of customer questions for a support analytics dashboard.

You will be given real questions that were all asked about the same subject.

Reply in exactly this format, two lines, nothing else:
LABEL: <a short noun phrase, 2 to 6 words, naming the subject>
SUMMARY: <one or two sentences on what these people actually want and where they get stuck>

Rules:
- The label names the subject, not the action: "Refund timing", not "Customer asks about refund timing".
- Use the vocabulary of the questions themselves. Never invent a product name.
- No markdown, no quotes, no trailing period on the label.
- If the questions have nothing in common, say so in the summary and label it "Mixed questions".`;

function clip(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Renders the questions as a prompt, newest first, oldest dropped at the cap. */
export function buildLabelPrompt(questions: ReadonlyArray<string>): string {
  const lines = questions
    .slice(0, LABEL_MAX_QUESTIONS)
    .map((question) => `- ${clip(question, MAX_QUESTION_CHARS)}`)
    .join("\n");
  return `Questions in this cluster:\n${lines}`;
}

export interface ParsedLabel {
  label: string | null;
  summary: string | null;
}

/**
 * Reads `LABEL:` / `SUMMARY:` out of a model reply.
 *
 * DELIBERATELY FORGIVING, AND THE REASON MATTERS. The mock gateway used in
 * development and tests replies in prose and will never emit this format, and a
 * hosted model will occasionally wrap it in markdown or add a preamble. A
 * parser that returned nothing in those cases would leave every topic
 * permanently unnamed in local development, so an unrecognized reply yields
 * `label: null` and the caller falls back to `deriveFallbackLabel`. Failing to
 * parse is an expected outcome here, not an error.
 */
export function parseLabelReply(reply: string): ParsedLabel {
  const text = reply.trim();
  if (!text) return { label: null, summary: null };

  const labelMatch = text.match(/^\s*(?:\*\*)?LABEL(?:\*\*)?\s*:\s*(.+)$/im);
  const summaryMatch = text.match(/^\s*(?:\*\*)?SUMMARY(?:\*\*)?\s*:\s*([\s\S]+?)(?:\n\s*\n|$)/im);

  const label = labelMatch?.[1] ? cleanLabel(labelMatch[1]) : null;
  // Models bold the key as `**SUMMARY:**`, putting the asterisks AFTER the
  // colon, so they land inside the capture rather than being matched by the
  // optional pair before it.
  const summary = summaryMatch?.[1] ? clip(stripDecoration(summaryMatch[1]), MAX_TOPIC_SUMMARY_CHARS) : null;

  return { label: label || null, summary: summary || null };
}

function stripDecoration(raw: string): string {
  return raw.replace(/^[*_`\s]+/, "").replace(/[*_`\s]+$/, "");
}

/** Strips the decoration models add around a short phrase. */
function cleanLabel(raw: string): string {
  const stripped = raw
    .trim()
    .replace(/^["'`*_\s]+|["'`*_\s]+$/g, "")
    .replace(/[.,;:]+$/, "")
    .replace(/\s+/g, " ");
  return clip(stripped, MAX_TOPIC_LABEL_CHARS);
}

/** Words too common to identify a subject, so a label built from them says nothing. */
const STOP_WORDS = new Set([
  "a", "about", "an", "and", "any", "are", "can", "did", "do", "does", "for", "from", "get", "has", "have",
  "how", "i", "if", "in", "is", "it", "me", "my", "of", "on", "or", "our", "that", "the", "there",
  "this", "to", "was", "we", "what", "when", "where", "which", "why", "will", "with", "you", "your",
]);

/**
 * A readable topic name derived from the questions alone, with no model call.
 *
 * Used when the reply could not be parsed, and as the placeholder a brand-new
 * topic carries until a run gets around to labelling it - `label` is NOT NULL
 * precisely so an unlabelled topic is still readable in a list.
 *
 * The heuristic is the shortest question that is an actual question: at least
 * three words, of which at least one carries meaning. Shortest, because the
 * tersest phrasing in a cluster is almost always the closest thing it contains
 * to a title. The floors exist because "help?" is shorter than all of them and
 * names nothing - and note that they cannot BOTH be counts of meaningful words,
 * since "How do I get a refund" is a perfectly good label containing exactly
 * one word that is not a stop word.
 */
export function deriveFallbackLabel(questions: ReadonlyArray<string>): string {
  const candidates = questions
    .map((question) => question.trim().replace(/\s+/g, " "))
    .filter((question) => question.length > 0)
    .filter((question) => {
      const counts = wordCounts(question);
      return counts.total >= 3 && counts.meaningful >= 1;
    });

  const best = candidates.reduce<string | null>(
    (shortest, question) => (shortest === null || question.length < shortest.length ? question : shortest),
    null,
  );

  const fallback = best ?? questions.find((question) => question.trim().length > 0)?.trim() ?? "Unlabelled topic";
  return clip(fallback.replace(/[?!.]+$/, ""), MAX_TOPIC_LABEL_CHARS) || "Unlabelled topic";
}

function wordCounts(question: string): { total: number; meaningful: number } {
  const words = question.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  return {
    total: words.length,
    meaningful: words.filter((word) => word.length > 2 && !STOP_WORDS.has(word)).length,
  };
}
