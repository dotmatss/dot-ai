/**
 * Namespacing for MCP tool references.
 *
 * Pure string handling, no Node APIs, so the configuration UI can import it.
 * The hashing that pins an approval lives in `server/tool-identity.ts`.
 */

/** Separator between the parts of a namespaced tool reference. */
const REF_SEPARATOR = ".";

/** Prefix that marks a tool reference as coming from MCP rather than built in. */
export const MCP_REF_PREFIX = "mcp";

/**
 * Namespaced reference the model sees: `mcp.{serverSlug}.{toolName}`.
 *
 * The specification notes that tool names are unique only within a server, and
 * that a client aggregating several servers **SHOULD** disambiguate. It also
 * warns that the server's self-reported name is not unique and must not be
 * used for this, which is why our own slug is.
 */
export function toolRef(serverSlug: string, toolName: string): string {
  return [MCP_REF_PREFIX, serverSlug, toolName].join(REF_SEPARATOR);
}

export interface ParsedToolRef {
  serverSlug: string;
  toolName: string;
}

/**
 * Splits a namespaced reference back apart.
 *
 * Tool names may contain dots (the spec allows `admin.tools.list`), so the
 * split is on the first two separators only and the remainder is the tool
 * name. Getting this wrong would silently truncate such a name and resolve the
 * wrong tool, or none.
 */
export function parseToolRef(ref: string): ParsedToolRef | null {
  const parts = ref.split(REF_SEPARATOR);
  if (parts.length < 3) return null;
  const [prefix, serverSlug, ...rest] = parts;
  if (prefix !== MCP_REF_PREFIX) return null;
  if (!serverSlug) return null;
  const toolName = rest.join(REF_SEPARATOR);
  if (!toolName) return null;
  return { serverSlug, toolName };
}

export function isMcpToolRef(ref: string): boolean {
  return parseToolRef(ref) !== null;
}

