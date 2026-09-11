/**
 * Documentation is authored as structured blocks rather than as JSX or MDX.
 *
 * The reason is drift: a table of contents, the search index and the rendered
 * page all need the same headings and prose. Deriving them from one data
 * structure means they cannot disagree, and it keeps the renderer free to
 * change without touching a single page. It also avoids adding an MDX
 * toolchain for content we write ourselves.
 */

export type DocBlock =
  | { type: "heading"; id: string; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "code"; code: string; language?: string; label?: string }
  | { type: "callout"; tone: "info" | "warning" | "danger" | "success"; title?: string; body: string }
  | { type: "endpoint"; method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; auth: string; summary: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "steps"; items: Array<{ title: string; body: string }> }
  | { type: "divider" };

/** Whether a documented behaviour exists today or is a proposed contract. */
export type DocStatus = "implemented" | "proposed";

export interface DocPage {
  /** Path under /docs, e.g. "api/chat". */
  slug: string;
  title: string;
  /** One sentence; used for the page description, search and metadata. */
  description: string;
  status?: DocStatus;
  blocks: DocBlock[];
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

export interface DocHeading {
  id: string;
  text: string;
}

export function headingsOf(page: DocPage): DocHeading[] {
  return page.blocks
    .filter((block): block is Extract<DocBlock, { type: "heading" }> => block.type === "heading")
    .map((block) => ({ id: block.id, text: block.text }));
}

/** Flat text of a page, for the search index. */
export function searchTextOf(page: DocPage): string {
  const parts: string[] = [page.title, page.description];
  for (const block of page.blocks) {
    switch (block.type) {
      case "heading":
      case "paragraph":
        parts.push(block.text);
        break;
      case "list":
        parts.push(block.items.join(" "));
        break;
      case "callout":
        parts.push(block.title ?? "", block.body);
        break;
      case "endpoint":
        parts.push(block.method, block.path, block.summary);
        break;
      case "table":
        parts.push(block.head.join(" "), block.rows.map((row) => row.join(" ")).join(" "));
        break;
      case "steps":
        parts.push(block.items.map((item) => `${item.title} ${item.body}`).join(" "));
        break;
      default:
        break;
    }
  }
  return parts.join(" ").toLowerCase();
}
