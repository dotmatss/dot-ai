import "server-only";

import { MCP_LIMITS, MCP_TOOL_NAME_PATTERN } from "@/features/mcp/constants";
import { toolContentHash } from "@/features/mcp/server/tool-identity";
import type { McpDiscoveredTool, McpToolAnnotationClaims } from "@/features/mcp/types";

/**
 * Validation of tool metadata coming back from a server.
 *
 * A connected MCP server is untrusted input, in the strongest sense: a
 * customer typed its URL, and everything it returns is attacker-controlled
 * from our point of view. So a tool definition is validated before it is
 * stored, and a bad one is **excluded rather than fatal** — the specification
 * requires exactly that for the `x-mcp-header` case, and the same reasoning
 * applies generally: one malformed tool must not stop the other nineteen from
 * working.
 *
 * Nothing here throws. Every function returns what it accepted plus what it
 * rejected and why, so the UI can tell a customer that three of their tools
 * were skipped and for what reason.
 */

export interface RejectedTool {
  /** The name as received, truncated. May be absent or not a string. */
  name: string;
  reason: string;
}

export interface ValidatedTools {
  tools: McpDiscoveredTool[];
  rejected: RejectedTool[];
  /** True when the server offered more tools than we will store. */
  truncated: boolean;
}

function describeName(value: unknown): string {
  if (typeof value !== "string") return `<${typeof value}>`;
  return value.length > 64 ? `${value.slice(0, 64)}…` : value;
}

/** Depth of a plain JSON value, used to bound validation and storage cost. */
function jsonDepth(value: unknown, depth = 0): number {
  if (depth > MCP_LIMITS.maxSchemaDepth) return depth;
  if (Array.isArray(value)) {
    let max = depth;
    for (const item of value) max = Math.max(max, jsonDepth(item, depth + 1));
    return max;
  }
  if (value === null || typeof value !== "object") return depth;
  let max = depth;
  for (const item of Object.values(value as Record<string, unknown>)) {
    max = Math.max(max, jsonDepth(item, depth + 1));
  }
  return max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only the four specified hints, and only when they are actually booleans. */
function readAnnotations(value: unknown): McpToolAnnotationClaims {
  if (!isPlainObject(value)) return {};
  const claims: McpToolAnnotationClaims = {};
  for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
    if (typeof value[key] === "boolean") claims[key] = value[key];
  }
  return claims;
}

function tooLarge(value: unknown): boolean {
  // Byte length rather than character count: a schema of astral-plane
  // characters is twice the storage a `.length` check would suggest.
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8") > MCP_LIMITS.maxSchemaBytes;
}

/** Validates one tool. Returns the tool, or the reason it was rejected. */
export function validateTool(raw: unknown): { ok: true; tool: McpDiscoveredTool } | { ok: false; rejected: RejectedTool } {
  if (!isPlainObject(raw)) {
    return { ok: false, rejected: { name: describeName(raw), reason: "The tool definition was not an object." } };
  }

  const name = raw.name;
  if (typeof name !== "string" || !MCP_TOOL_NAME_PATTERN.test(name)) {
    return {
      ok: false,
      rejected: {
        name: describeName(name),
        reason: "The tool name must be 1 to 128 characters of letters, digits, underscore, hyphen or dot.",
      },
    };
  }

  // The spec: inputSchema MUST be a valid JSON Schema object, not null.
  if (!isPlainObject(raw.inputSchema)) {
    return { ok: false, rejected: { name, reason: "The tool has no input schema object." } };
  }
  if (raw.outputSchema !== undefined && raw.outputSchema !== null && !isPlainObject(raw.outputSchema)) {
    return { ok: false, rejected: { name, reason: "The output schema was present but was not an object." } };
  }
  if (tooLarge(raw.inputSchema) || tooLarge(raw.outputSchema)) {
    return { ok: false, rejected: { name, reason: "The tool schema is larger than we will store." } };
  }
  if (jsonDepth(raw.inputSchema) > MCP_LIMITS.maxSchemaDepth) {
    return { ok: false, rejected: { name, reason: "The tool schema is nested more deeply than we will process." } };
  }

  // `x-mcp-header` lets a server mirror a parameter into an HTTP header.
  // Clients MUST reject a tool whose annotation breaks the rules, and we go
  // further in this phase: we reject any tool that uses it at all, because we
  // do not yet implement the mirroring and silently dropping a header the
  // server expects would produce a confusing HeaderMismatch on every call.
  const headerAnnotation = findMcpHeaderAnnotation(raw.inputSchema);
  if (headerAnnotation) {
    return {
      ok: false,
      rejected: {
        name,
        reason: `This tool asks for the “${headerAnnotation}” parameter to be sent as an HTTP header, which this platform does not support yet.`,
      },
    };
  }

  const description = typeof raw.description === "string" ? raw.description.slice(0, MCP_LIMITS.maxDescriptionLength) : null;
  const title = typeof raw.title === "string" ? raw.title.slice(0, 200) : null;
  const annotations = readAnnotations(raw.annotations);
  const inputSchema = raw.inputSchema;
  const outputSchema = isPlainObject(raw.outputSchema) ? raw.outputSchema : null;

  return {
    ok: true,
    tool: {
      name,
      title,
      description,
      inputSchema,
      outputSchema,
      annotations,
      contentHash: toolContentHash({ name, description, inputSchema, outputSchema, annotations }),
    },
  };
}

/** Finds any `x-mcp-header` annotation anywhere in a schema. */
function findMcpHeaderAnnotation(schema: unknown, depth = 0): string | null {
  if (depth > MCP_LIMITS.maxSchemaDepth) return null;
  if (Array.isArray(schema)) {
    for (const item of schema) {
      const found = findMcpHeaderAnnotation(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isPlainObject(schema)) return null;
  if (typeof schema["x-mcp-header"] === "string") return schema["x-mcp-header"];
  for (const value of Object.values(schema)) {
    const found = findMcpHeaderAnnotation(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Validates a whole discovered list.
 *
 * Duplicate names are dropped after the first: the spec says names **SHOULD**
 * be unique within a server, so a duplicate is possible, and silently keeping
 * the last one would mean the tool a customer approved is not the tool that
 * gets called.
 */
export function validateTools(raw: unknown): ValidatedTools {
  if (!Array.isArray(raw)) return { tools: [], rejected: [], truncated: false };

  const tools: McpDiscoveredTool[] = [];
  const rejected: RejectedTool[] = [];
  const seen = new Set<string>();
  let truncated = false;

  for (const entry of raw) {
    if (tools.length >= MCP_LIMITS.maxToolsPerServer) {
      truncated = true;
      break;
    }
    const result = validateTool(entry);
    if (!result.ok) {
      rejected.push(result.rejected);
      continue;
    }
    if (seen.has(result.tool.name)) {
      rejected.push({ name: result.tool.name, reason: "The server listed this tool name more than once." });
      continue;
    }
    seen.add(result.tool.name);
    tools.push(result.tool);
  }

  return { tools, rejected, truncated };
}
