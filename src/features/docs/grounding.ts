import { DOC_SEARCH_INDEX, searchDocs } from "@/features/docs/search-index";
import { DOC_PAGES, findDocPage } from "@/features/docs/registry";
import type { DocBlock, DocPage } from "@/features/docs/types";
import type { RetrievedSource } from "@/types/ai";

/**
 * Turns the published documentation into grounding material.
 *
 * The public chat demo answers from these pages and nothing else. That is a
 * deliberate boundary, not a shortcut: the documentation is authored as data,
 * reviewed, and already guarded by `tests/unit/docs-content.test.ts`, which
 * fails the build if a credential or an unsupported claim appears in it. A
 * demo grounded in it therefore cannot promise a capability the product does
 * not have, and cannot leak anything, because there is nothing else to read.
 *
 * This lives in the docs feature because it is documentation data. The public
 * chatbot consumes it rather than reaching into another feature's content.
 */

/** Readable prose for a block, or null for blocks that carry no useful text. */
function blockToText(block: DocBlock): string | null {
  switch (block.type) {
    case "heading":
      return `\n## ${block.text}`;
    case "paragraph":
      return block.text;
    case "list":
      return block.items.map((item) => `- ${item}`).join("\n");
    case "callout":
      return block.title ? `${block.title}: ${block.body}` : block.body;
    case "endpoint":
      return `${block.method} ${block.path} (auth: ${block.auth}) - ${block.summary}`;
    case "table":
      return [block.head.join(" | "), ...block.rows.map((row) => row.join(" | "))].join("\n");
    case "steps":
      return block.items.map((item, index) => `${index + 1}. ${item.title}: ${item.body}`).join("\n");
    case "code":
      // Code samples are included: "show me a curl example" is a fair question
      // for a developer-facing demo, and every sample uses a placeholder key.
      return block.label ? `${block.label}:\n${block.code}` : block.code;
    case "divider":
      return null;
    default:
      return null;
  }
}

/** A whole page rendered as plain text, for the model to read. */
export function docPageToPlainText(page: DocPage): string {
  const body = page.blocks
    .map(blockToText)
    .filter((text): text is string => Boolean(text))
    .join("\n");
  const status = page.status === "proposed" ? "\n(Status: PROPOSED - not implemented yet.)" : "";
  return `# ${page.title}\n${page.description}${status}\n${body}`.trim();
}

/**
 * Words that carry no signal in a question but score against every page.
 *
 * The documentation search box is typed into with keywords; the demo is typed
 * into with sentences. "How do I add a chatbot to my website?" scored the
 * Chatbots page above the Embed page purely because the filler words matched
 * more prose, and "website?" matched nothing at all because of the question
 * mark. Normalising here rather than in `searchDocs` keeps the search box
 * behaving exactly as before.
 */
const QUESTION_STOPWORDS = new Set([
  "a", "about", "an", "and", "any", "are", "as", "at", "be", "can", "could", "do", "does", "doing", "for", "from",
  "get", "got", "has", "have", "how", "i", "if", "in", "into", "is", "it", "its", "just", "me", "my", "of", "on",
  "or", "our", "should", "so", "than", "that", "the", "their", "them", "then", "there", "these", "they", "this",
  "to", "up", "use", "using", "want", "was", "we", "what", "when", "where", "which", "who", "why", "will", "with",
  "would", "you", "your",
]);

/** Strips punctuation and filler so ranking sees only meaningful words. */
export function normalizeQuestion(question: string): string {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s/._-]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !QUESTION_STOPWORDS.has(word));

  // If a question is nothing but filler ("what is it about?"), fall back to
  // the raw text rather than searching for an empty string.
  return words.length > 0 ? words.join(" ") : question;
}

export interface DocContext {
  /** Documentation pages the answer should be built from. */
  sources: RetrievedSource[];
  /** The same pages as text, ready to place in a system message. */
  text: string;
}

/** Pages shown when a question matches nothing, so the demo is never blank. */
const FALLBACK_SLUGS = ["getting-started", "concepts", "chatbots"] as const;

function toSource(page: DocPage, characters: number): RetrievedSource {
  const text = docPageToPlainText(page);
  return {
    id: page.slug,
    title: page.title,
    snippet: text.length > characters ? `${text.slice(0, characters).trimEnd()}…` : text,
    uri: `/docs/${page.slug}`,
  };
}

/**
 * Finds the documentation most relevant to a question.
 *
 * Reuses the same ranking the documentation search box uses, so what the demo
 * reads and what a visitor would find by searching are the same thing. Each
 * page is truncated because a prompt that includes every page would be mostly
 * noise and would cost more on every message.
 */
export function retrieveDocContext(question: string, options: { limit?: number; charactersPerPage?: number } = {}): DocContext {
  const limit = options.limit ?? 4;
  const charactersPerPage = options.charactersPerPage ?? 2_000;

  const matches = searchDocs(normalizeQuestion(question), limit);
  const pages =
    matches.length > 0
      ? matches.map((match) => findDocPage(match.slug)).filter((page): page is DocPage => Boolean(page))
      : FALLBACK_SLUGS.map((slug) => findDocPage(slug)).filter((page): page is DocPage => Boolean(page));

  const sources = pages.map((page) => toSource(page, charactersPerPage));
  const text = sources.map((source) => `--- ${source.title} (/docs/${source.id}) ---\n${source.snippet}`).join("\n\n");

  return { sources, text };
}

/** Every page title, so the model can say what documentation exists. */
export function docTitleIndex(): string {
  return DOC_SEARCH_INDEX.map((entry) => `- ${entry.title} (/docs/${entry.slug}): ${entry.description}`).join("\n");
}

/** Total pages available for grounding. Used by tests and diagnostics. */
export function docCorpusSize(): number {
  return DOC_PAGES.length;
}
