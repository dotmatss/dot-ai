/**
 * HTML → readable text extraction for URL ingestion.
 *
 * Deliberately regex based: a full DOM parser would be a new dependency, and
 * the goal is not fidelity but a clean text stream to chunk and index. Anything
 * that is not prose (scripts, styles, head metadata, SVG, templates) is dropped
 * before tags are stripped, so ingested content never contains code that would
 * pollute retrieval or be replayed into a prompt.
 */

const DROPPED_ELEMENTS = ["script", "style", "head", "noscript", "svg", "template", "iframe", "object", "canvas"];

/** Tags whose boundaries are paragraph breaks in the extracted text. */
const BLOCK_ELEMENTS = [
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dd",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
];

/**
 * Structure has to survive the whitespace collapse below, so block and line
 * breaks are carried as control characters that cannot appear in real prose.
 */
const LINE_MARKER = "\u0001";
const BLOCK_MARKER = "\u0002";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  middot: "·",
  bull: "•",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
};

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const code = Number.parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** The document title, used to name a source when the user did not provide one. */
export function extractHtmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) return null;
  const title = decodeHtmlEntities(match[1].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  return title || null;
}

export function htmlToText(html: string): string {
  // Strip the markers up front so decoded content can never forge structure.
  let text = html.replace(/[\u0001\u0002]/g, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ");

  for (const element of DROPPED_ELEMENTS) {
    // The `|$` alternative drops an unterminated element too, so a truncated
    // download cannot leak the tail of a <script> into the text.
    text = text.replace(new RegExp(`<${element}\\b[^>]*>[\\s\\S]*?(?:</${element}\\s*>|$)`, "gi"), " ");
    text = text.replace(new RegExp(`</?${element}\\b[^>]*>`, "gi"), " ");
  }

  text = text.replace(/<br\s*\/?>/gi, LINE_MARKER);
  text = text.replace(new RegExp(`</?(?:${BLOCK_ELEMENTS.join("|")})\\b[^>]*>`, "gi"), BLOCK_MARKER);
  text = text.replace(/<[^>]*>/g, " ");
  text = decodeHtmlEntities(text);

  // A browser collapses every run of source whitespace inside a block, so the
  // only real breaks are the ones the markers record.
  return text
    .replace(/\s+/g, " ")
    .replace(new RegExp(`\\s*${LINE_MARKER}\\s*`, "g"), "\n")
    .replace(new RegExp(`(?:\\s*${BLOCK_MARKER}\\s*)+`, "g"), "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when a decoded payload plausibly is UTF-8 text rather than binary. */
export function looksLikeText(decoded: string): boolean {
  if (decoded.includes("\u0000")) return false;
  const replacements = decoded.match(/\ufffd/g)?.length ?? 0;
  return replacements / Math.max(1, decoded.length) < 0.02;
}
