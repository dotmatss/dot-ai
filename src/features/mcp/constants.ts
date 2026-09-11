import type { McpAuthKind, McpRiskClass, McpServerStatus, McpToolAnnotationClaims } from "@/features/mcp/types";
import type { BadgeTone } from "@/components/ui/app-badge";

/** Caps on what we will accept from a server. A server is untrusted input. */
export const MCP_LIMITS = {
  /** Tools stored per server. A server offering more is truncated, visibly. */
  maxToolsPerServer: 200,
  /** `tools/list` pages we will follow before giving up on a bad cursor. */
  maxDiscoveryPages: 20,
  /** Characters of a tool description kept. Long enough to be useful, bounded. */
  maxDescriptionLength: 4_000,
  /** Serialised bytes of a single tool's schemas. */
  maxSchemaBytes: 64_000,
  /** Nesting depth allowed in a tool schema, to bound validation cost. */
  maxSchemaDepth: 12,
  /** Wall-clock budget for a probe or a discovery, redirects included. */
  requestTimeoutMs: 10_000,
  /** Servers one workspace may configure, until entitlements exist. */
  maxServersPerWorkspace: 10,

  // --- Execution. A tool call reaches a third party and its result reaches a
  // model, so both directions are bounded.

  /**
   * Wall-clock budget for one `tools/call`. Longer than a discovery because a
   * tool may legitimately do work, but still bounded: it is held open inside a
   * request.
   */
  callTimeoutMs: 30_000,
  /** Serialised bytes of arguments we will send. */
  maxArgumentBytes: 32_000,
  /** Serialised bytes of a result we will keep. Beyond this it is truncated. */
  maxResultBytes: 64_000,
  /**
   * Characters of result text handed to the model. A result is untrusted text
   * from a third party, and an unbounded one is both a cost and a way to push
   * the system prompt out of the context window.
   */
  maxResultTextLength: 16_000,
  /**
   * Tool calls executed in a single agent turn. Without a bound, a model that
   * keeps asking would keep spending money and keep touching customer systems.
   */
  maxCallsPerTurn: 5,
} as const;

/**
 * Tool name policy.
 *
 * The specification's allowed set is ASCII letters, digits, underscore,
 * hyphen and dot, and names **SHOULD** be 1 to 128 characters. Those are
 * SHOULDs, so a server may send something else; we enforce them anyway and
 * exclude a tool that does not comply rather than passing it to a model.
 */
export const MCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

export const MCP_SERVER_STATUS_META: Record<McpServerStatus, { label: string; tone: BadgeTone; description: string }> = {
  draft: { label: "Not tested", tone: "neutral", description: "Configured but never successfully reached." },
  active: { label: "Active", tone: "success", description: "The last probe succeeded and tools were discovered." },
  error: { label: "Error", tone: "danger", description: "The last probe failed. Check the endpoint and try again." },
  unauthorized: { label: "Unauthorized", tone: "warning", description: "The server rejected our credential." },
  disabled: { label: "Disabled", tone: "neutral", description: "Switched off. Its tools are offered to nothing." },
};

export const MCP_RISK_META: Record<McpRiskClass, { label: string; tone: BadgeTone; description: string }> = {
  read: { label: "Read", tone: "info", description: "Reads data without changing anything." },
  write: { label: "Write", tone: "warning", description: "Creates or changes data." },
  destructive: {
    label: "Destructive",
    tone: "danger",
    description: "Deletes data, sends something, or takes an action that cannot be undone.",
  },
};

export const MCP_AUTH_KIND_META: Record<McpAuthKind, { label: string; description: string }> = {
  none: { label: "None", description: "The server is open, or restricts access some other way." },
  header: { label: "Header credential", description: "A token we send in a request header on every call." },
  oauth: {
    label: "OAuth 2.1",
    description: "You sign in at the server and it decides what we may do. Access can be revoked at the source.",
  },
};

/** Default header for a bearer credential. Customers may override it. */
export const MCP_DEFAULT_CREDENTIAL_HEADER = "Authorization";

/**
 * Risk we would suggest, from the server's claimed annotations.
 *
 * ADVISORY ONLY. This pre-selects a radio button in the approval UI; it never
 * decides anything. The specification requires clients to treat annotations as
 * untrusted, and the guidance is blunt that "a server can lie about its tool's
 * behavior". The authoritative risk class is the one a person picks.
 *
 * The default when a server says nothing is `write`, not `read`: silence is not
 * evidence of harmlessness, and the safe reading of an unknown tool is that it
 * changes something.
 */
export function suggestRiskClass(annotations: McpToolAnnotationClaims): McpRiskClass {
  if (annotations.destructiveHint === true) return "destructive";
  if (annotations.readOnlyHint === true) return "read";
  return "write";
}

/**
 * Whether a risk class requires a person to approve each call by default.
 *
 * Destructive is not merely defaulted to approval, it is pinned there: the
 * approval requirement cannot be switched off for a destructive tool in this
 * phase. That is a deliberate limit on how much rope the configuration UI
 * gives someone.
 */
export function defaultRequiresApproval(riskClass: McpRiskClass): boolean {
  return riskClass !== "read";
}

export function approvalIsMandatory(riskClass: McpRiskClass): boolean {
  return riskClass === "destructive";
}

/**
 * The protocol revision this client implements.
 *
 * Recorded here so it appears in code review when it moves, and so the
 * documentation and the implementation cannot disagree about it.
 */
export const MCP_PROTOCOL_REVISION = "2026-07-28";
