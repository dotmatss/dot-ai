import { desc, sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { agents } from "@/server/db/schema/chatbots";
import { conversations } from "@/server/db/schema/conversations";
import { users } from "@/server/db/schema/identity";
import { workspaces } from "@/server/db/schema/tenancy";

/**
 * Model Context Protocol, phase 1.
 *
 * Describes the tables created by `0015_mcp.sql`. As everywhere in this
 * directory, the migration is the source of truth and this is the typing
 * layer; `tests/unit/schema-drift.integration.test.ts` holds the two together.
 *
 * The `CHECK` constraint that stops a destructive grant having its approval
 * requirement disabled is not expressible here, and neither are the RLS
 * policies. Both live in the migration. See `src/server/db/schema/index.ts`.
 */

/** Single-valued on purpose: adding stdio would be a visible schema change. */
export const mcpTransport = pgEnum("mcp_transport", ["http"]);
export const mcpAuthKind = pgEnum("mcp_auth_kind", ["none", "header", "oauth"]);
export const mcpServerStatus = pgEnum("mcp_server_status", ["draft", "active", "error", "unauthorized", "disabled"]);
export const mcpRiskClass = pgEnum("mcp_risk_class", ["read", "write", "destructive"]);
export const mcpGrantState = pgEnum("mcp_grant_state", ["active", "stale", "orphaned"]);

export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Ours, used to namespace tool references. Never the server's own name. */
    slug: text("slug").notNull(),
    endpointUrl: text("endpoint_url").notNull(),
    transport: mcpTransport("transport").notNull().default("http"),
    authKind: mcpAuthKind("auth_kind").notNull().default("none"),
    status: mcpServerStatus("status").notNull().default("draft"),
    lastProbeAt: timestamp("last_probe_at", { withTimezone: true }),
    lastProbeOk: boolean("last_probe_ok"),
    /** Sanitised: host and condition only, never a URL or a credential. */
    lastProbeMessage: text("last_probe_message"),
    toolCount: integer("tool_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("mcp_servers_workspace_id_slug_key").on(table.workspaceId, table.slug),
    index("mcp_servers_workspace_idx").on(table.workspaceId, table.updatedAt.desc()),
  ],
);

/**
 * One sealed AES-256-GCM envelope per server, in its own table so ciphertext
 * stays out of every list query. Mirrors `integration_secrets`.
 */
export const mcpServerSecrets = pgTable(
  "mcp_server_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    /** Which header the credential travels in. Not itself secret. */
    headerName: text("header_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_server_secrets_server_idx").on(table.mcpServerId),
    index("mcp_server_secrets_workspace_idx").on(table.workspaceId),
  ],
);

/**
 * What the server offered at the last discovery, after validation.
 *
 * Rows are kept when a tool disappears, with `removedAt` set, so the UI can
 * explain why a grant went orphaned rather than the tool simply vanishing.
 */
export const mcpServerTools = pgTable(
  "mcp_server_tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title"),
    description: text("description"),
    inputSchema: jsonb("input_schema").notNull().default({}),
    outputSchema: jsonb("output_schema"),
    /** The hints the server CLAIMS. Shown to a person, never an authorization input. */
    annotations: jsonb("annotations").notNull().default({}),
    /** sha256 of the canonical representation. See `mcp/server/tool-identity.ts`. */
    contentHash: text("content_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    unique("mcp_server_tools_mcp_server_id_name_key").on(table.mcpServerId, table.name),
    index("mcp_server_tools_workspace_idx").on(table.workspaceId),
    index("mcp_server_tools_server_idx").on(table.mcpServerId, table.name),
  ],
);

/**
 * A tool a person approved, pinned to the definition they saw.
 *
 * `state` is a cached convenience for listing and is never the authority: the
 * live hash comparison in `src/features/mcp/grants.ts` decides, because a
 * stored flag can be stale by exactly the window that matters.
 */
export const mcpToolGrants = pgTable(
  "mcp_tool_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    /** The content hash at the moment of approval. The pin. */
    approvedHash: text("approved_hash").notNull(),
    riskClass: mcpRiskClass("risk_class").notNull(),
    requiresApproval: boolean("requires_approval").notNull().default(true),
    state: mcpGrantState("state").notNull().default("active"),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("mcp_tool_grants_mcp_server_id_tool_name_key").on(table.mcpServerId, table.toolName),
    index("mcp_tool_grants_workspace_idx").on(table.workspaceId),
    index("mcp_tool_grants_server_idx").on(table.mcpServerId, table.toolName),
  ],
);

/**
 * Model Context Protocol, phase 2: the execution record.
 *
 * Created by `0017_mcp_tool_calls.sql`. One table is both the audit log and
 * the approvals queue, because a call waiting for a person is the same call
 * that later ran; see the migration for why that is one row rather than two
 * tables.
 *
 * Three `CHECK` constraints are not expressible here and live in the
 * migration: a queued call must name a server, a decision must have both a
 * decider and a time, and only an executed call may carry a result or a
 * duration.
 */

/**
 * The lifecycle of a call.
 *
 * `failed` is a call we made that did not complete. A tool that ran and
 * reported a business error is `executed` with `isError`, because it did run
 * and may have had effects — collapsing the two would lose that distinction.
 */
export const mcpCallStatus = pgEnum("mcp_call_status", [
  "refused",
  "awaiting_approval",
  "denied",
  "running",
  "executed",
  "failed",
  "expired",
]);

/** Mirrors `MCP_RESOLUTION_STATUSES`. The permission decision, kept alongside the lifecycle. */
export const mcpResolutionStatus = pgEnum("mcp_resolution_status", [
  "resolved",
  "not_granted",
  "not_attached",
  "stale_grant",
  "approval_required",
  "server_unavailable",
  "unknown_tool",
]);

export const mcpToolCalls = pgTable(
  "mcp_tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Null when the reference named a server this workspace does not have. */
    mcpServerId: uuid("mcp_server_id").references(() => mcpServers.id, { onDelete: "set null" }),
    /** Set null rather than cascaded: the audit record outlives the configuration. */
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    /** What the model asked for, and what we looked up. A mismatch is diagnostic. */
    toolRef: text("tool_ref").notNull(),
    toolName: text("tool_name").notNull(),
    status: mcpCallStatus("status").notNull(),
    resolution: mcpResolutionStatus("resolution").notNull(),
    /** Copied at decision time: a grant can change afterwards. */
    riskClass: mcpRiskClass("risk_class"),
    approvedHash: text("approved_hash"),
    arguments: jsonb("arguments").notNull().default({}),
    result: jsonb("result"),
    /** Size before truncation, so the log does not misreport what came back. */
    resultBytes: integer("result_bytes"),
    resultTruncated: boolean("result_truncated").notNull().default(false),
    /** The server's own error flag, distinct from a failed call. */
    isError: boolean("is_error").notNull().default(false),
    /** Sanitised: never an endpoint URL, a credential or a response body. */
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("mcp_tool_calls_workspace_idx").on(table.workspaceId, desc(table.createdAt)),
    // Partial: the pending set is tiny next to the log, and this is the query
    // a person's screen polls.
    index("mcp_tool_calls_pending_idx")
      .on(table.workspaceId, table.createdAt)
      .where(sql`status = 'awaiting_approval'`),
    index("mcp_tool_calls_server_idx").on(table.mcpServerId, desc(table.createdAt)),
    index("mcp_tool_calls_conversation_idx").on(table.conversationId),
  ],
);

/**
 * Model Context Protocol, phase 2d: OAuth 2.1.
 *
 * Created by `0018_mcp_oauth.sql`. Two tables because an in-flight
 * authorization and an issued token have different lifetimes: the first is
 * deleted the moment it is redeemed, so a PKCE verifier cannot outlive the one
 * exchange it authorises.
 *
 * There is no `client_secret`. Revision 2026-07-28 deprecates Dynamic Client
 * Registration in favour of a Client ID Metadata Document, so `clientId` holds
 * the URL of a document we publish and there is no secret to keep.
 */
export const mcpOauthStates = pgTable(
  "mcp_oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    /** CSRF token for the round trip. Unique: a repeat is a replay or a bug. */
    state: text("state").notNull(),
    /** The PKCE verifier, sealed. It proves the code was requested by us. */
    verifierCiphertext: text("verifier_ciphertext").notNull(),
    verifierIv: text("verifier_iv").notNull(),
    verifierTag: text("verifier_tag").notNull(),
    /**
     * Captured when the flow started, not re-discovered on the way back: a
     * server that rewrites its metadata mid-flow must not be able to redirect
     * our token exchange somewhere else.
     */
    issuer: text("issuer").notNull(),
    authorizationEndpoint: text("authorization_endpoint").notNull(),
    tokenEndpoint: text("token_endpoint").notNull(),
    clientId: text("client_id").notNull(),
    scope: text("scope"),
    /** RFC 8707 resource indicator, so a token cannot be replayed elsewhere. */
    resource: text("resource").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("mcp_oauth_states_state_key").on(table.state),
    index("mcp_oauth_states_workspace_idx").on(table.workspaceId),
    index("mcp_oauth_states_expiry_idx").on(table.expiresAt),
  ],
);

export const mcpOauthTokens = pgTable(
  "mcp_oauth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    /** Recorded so a token is only ever sent back to the issuer that minted it. */
    issuer: text("issuer").notNull(),
    tokenEndpoint: text("token_endpoint").notNull(),
    clientId: text("client_id").notNull(),
    /** The RFC 8707 resource this token was minted for, reused on refresh. */
    resource: text("resource").notNull(),
    /** What was actually granted, which may be less than was asked for. */
    scope: text("scope"),
    accessCiphertext: text("access_ciphertext").notNull(),
    accessIv: text("access_iv").notNull(),
    accessTag: text("access_tag").notNull(),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    refreshCiphertext: text("refresh_ciphertext"),
    refreshIv: text("refresh_iv"),
    refreshTag: text("refresh_tag"),
    /** Set when a call returned `insufficient_scope`, so a step-up can be asked for. */
    needsScope: text("needs_scope"),
    authorizedBy: uuid("authorized_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_oauth_tokens_server_idx").on(table.mcpServerId),
    index("mcp_oauth_tokens_workspace_idx").on(table.workspaceId),
  ],
);
