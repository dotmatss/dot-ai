/**
 * Client-safe contracts for the MCP feature.
 *
 * The platform is an MCP **client**. It connects out to servers a customer
 * configures; it never exposes an MCP server of its own, and the two
 * directions are kept visibly separate (see `docs/mcp-evaluation.md` §16).
 *
 * Dates are ISO strings so every shape crosses the Server to Client Component
 * boundary unchanged. Nothing here imports Zod or the MCP SDK.
 */

/**
 * Transports this platform will talk.
 *
 * Streamable HTTP only, and that is a security decision rather than a
 * roadmap gap. `stdio` means launching a subprocess from customer-supplied
 * configuration, which on shared infrastructure is remote code execution as
 * our service account. It is not on this list and should not be added.
 */
export const MCP_TRANSPORTS = ["http"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/**
 * How we authenticate to the server.
 *
 * `oauth` is the specification's own answer and the only one where the server
 * decides what we may do: the user consents, the scope is the server's to set,
 * and access can be revoked at the source. `header` remains because many
 * servers offer nothing else.
 */
export const MCP_AUTH_KINDS = ["none", "header", "oauth"] as const;
export type McpAuthKind = (typeof MCP_AUTH_KINDS)[number];

/**
 * Server state.
 *
 * Note there is no "connected": protocol revision 2026-07-28 removed sessions
 * and the initialization handshake, so there is no connection to be in. This
 * is the outcome of the last probe.
 */
export const MCP_SERVER_STATUSES = ["draft", "active", "error", "unauthorized", "disabled"] as const;
export type McpServerStatus = (typeof MCP_SERVER_STATUSES)[number];

/**
 * What a tool is allowed to do, as classified by **us and the customer**.
 *
 * Deliberately not derived from the server's annotations. The specification
 * requires clients to treat annotations as untrusted, and a server can simply
 * lie about them. Annotations inform the default selection in the approval UI
 * and nothing else.
 */
export const MCP_RISK_CLASSES = ["read", "write", "destructive"] as const;
export type McpRiskClass = (typeof MCP_RISK_CLASSES)[number];

/** Whether a grant still refers to the tool the customer actually approved. */
export const MCP_GRANT_STATES = ["active", "stale", "orphaned"] as const;
export type McpGrantState = (typeof MCP_GRANT_STATES)[number];

/**
 * The behaviour hints a server *claims* for a tool.
 *
 * Named "claims" on purpose. These are the four hints from the specification
 * (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`),
 * carried through so the UI can show them, attributed to the server.
 */
export interface McpToolAnnotationClaims {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** A tool as discovered from a server, after validation. */
export interface McpDiscoveredTool {
  /** The server's own tool name. Unique only within that server. */
  name: string;
  /** Optional display name. Not part of the content hash. */
  title: string | null;
  /**
   * The server's description. This reaches the model, so it is also the
   * primary prompt-injection surface, which is why it is hashed.
   */
  description: string | null;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  annotations: McpToolAnnotationClaims;
  /** Canonical hash of the fields that determine behaviour. See `tool-identity.ts`. */
  contentHash: string;
}

export interface McpServerSummary {
  id: string;
  name: string;
  slug: string;
  endpointUrl: string;
  transport: McpTransport;
  authKind: McpAuthKind;
  status: McpServerStatus;
  /** Whether a credential is configured. Never the credential itself. */
  hasCredential: boolean;
  /** Whether an OAuth authorization has been completed. Never the token. */
  hasOauthToken: boolean;
  /**
   * A scope the server asked for and we do not hold, when a call came back
   * with `insufficient_scope`. Null when there is nothing outstanding.
   */
  oauthNeedsScope: string | null;
  toolCount: number;
  grantedToolCount: number;
  staleGrantCount: number;
  lastProbeAt: string | null;
  lastProbeOk: boolean | null;
  /** Sanitised: host and status only, never a URL or a credential. */
  lastProbeMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpServer extends McpServerSummary {
  workspaceId: string;
  /** Header name the credential is sent in, when `authKind` is "header". */
  credentialHeader: string | null;
}

/** A grant is a decision by a person, pinned to what they saw. */
export interface McpToolGrant {
  serverId: string;
  toolName: string;
  /** The content hash at the moment of approval. */
  approvedHash: string;
  riskClass: McpRiskClass;
  requiresApproval: boolean;
  state: McpGrantState;
  grantedAt: string;
}

/** A discovered tool joined to its grant, for the approval UI. */
export interface McpToolView {
  tool: McpDiscoveredTool;
  grant: McpToolGrant | null;
  /** True when a grant exists but the tool has since been redefined. */
  stale: boolean;
  /** Risk class we would suggest, from the server's claims. Advisory only. */
  suggestedRiskClass: McpRiskClass;
}

/**
 * Why a tool call was or was not offered to the model.
 *
 * Mirrors the built-in agent tool vocabulary so the two report through one
 * path. `stale_grant` is the one MCP adds, because it is the one failure the
 * built-in tools cannot have.
 */
export const MCP_RESOLUTION_STATUSES = [
  "resolved",
  "not_granted",
  "not_attached",
  "stale_grant",
  "approval_required",
  "server_unavailable",
  "unknown_tool",
] as const;
export type McpResolutionStatus = (typeof MCP_RESOLUTION_STATUSES)[number];

export interface McpToolResolution {
  status: McpResolutionStatus;
  /** Namespaced identifier as the model sees it. */
  toolRef: string;
  serverId: string | null;
  toolName: string;
  reason: string;
}

/**
 * The lifecycle of a recorded tool call.
 *
 * Separate from the resolution above: the resolution says *why* a call was
 * decided the way it was, this says *what happened*. `failed` is a call we
 * made that did not complete; a tool that ran and reported a business error is
 * `executed` with `isError`, because it ran and may have had effects.
 */
export const MCP_CALL_STATUSES = [
  "refused",
  "awaiting_approval",
  "denied",
  "running",
  "executed",
  "failed",
  "expired",
] as const;
export type McpCallStatus = (typeof MCP_CALL_STATUSES)[number];

/** A recorded call, for the audit view and the approvals queue. */
export interface McpToolCall {
  id: string;
  serverId: string | null;
  /** Our name for the server at read time. Null when it has been removed. */
  serverName: string | null;
  agentId: string | null;
  agentName: string | null;
  conversationId: string | null;
  toolRef: string;
  toolName: string;
  status: McpCallStatus;
  resolution: McpResolutionStatus;
  riskClass: McpRiskClass | null;
  /** What the model asked for. Never a credential: arguments are model output. */
  arguments: unknown;
  /** Bounded rendering of what came back. Null until the call has run. */
  result: unknown;
  resultBytes: number | null;
  resultTruncated: boolean;
  isError: boolean;
  /** Sanitised: never a URL, a credential or a raw body. */
  errorMessage: string | null;
  durationMs: number | null;
  decidedAt: string | null;
  createdAt: string;
}
