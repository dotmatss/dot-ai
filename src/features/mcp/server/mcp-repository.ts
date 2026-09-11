import "server-only";

import { and, asc, count, desc, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import type { PoolClient } from "pg";

import type {
  McpAuthKind,
  McpCallStatus,
  McpDiscoveredTool,
  McpResolutionStatus,
  McpRiskClass,
  McpServer,
  McpServerStatus,
  McpServerSummary,
  McpToolCall,
  McpToolGrant,
} from "@/features/mcp/types";
import type { SealedSecret } from "@/features/integrations/server/secret-box";
import { withDb } from "@/server/db/client";
import {
  agents,
  mcpOauthStates,
  mcpOauthTokens,
  mcpServerSecrets,
  mcpServerTools,
  mcpServers,
  mcpToolCalls,
  mcpToolGrants,
} from "@/server/db/schema";
import { toIso, toIsoRequired } from "@/server/db/sql";

/**
 * MCP persistence.
 *
 * Built on Drizzle, following `src/features/chatbots/server/chatbot-repository.ts`
 * as the reference migration. Two rules, both of which the tests enforce:
 *
 *  - Every read and write filters on `workspace_id` explicitly. Row Level
 *    Security is the second line behind that, not a replacement for it.
 *  - The workspace id always comes from the caller's authorised context. No
 *    function here accepts an id from a request body.
 *
 * Multi-statement writes are expected to run inside `withWorkspace()`; those
 * functions take the transaction client so the RLS scope and the statements
 * share one connection.
 */

/** Counts that need a correlated subquery rather than a second round trip. */
const serverSelection = {
  id: mcpServers.id,
  workspaceId: mcpServers.workspaceId,
  name: mcpServers.name,
  slug: mcpServers.slug,
  endpointUrl: mcpServers.endpointUrl,
  transport: mcpServers.transport,
  authKind: mcpServers.authKind,
  status: mcpServers.status,
  lastProbeAt: mcpServers.lastProbeAt,
  lastProbeOk: mcpServers.lastProbeOk,
  lastProbeMessage: mcpServers.lastProbeMessage,
  toolCount: mcpServers.toolCount,
  createdAt: mcpServers.createdAt,
  updatedAt: mcpServers.updatedAt,
  // Written with explicit aliases and fully qualified outer references rather
  // than interpolated Drizzle columns. Interpolating them renders bare column
  // names, and inside a subquery over another table a bare `id` is ambiguous
  // between the two relations - PostgreSQL rejects it with 42702.
  hasCredential: sql<boolean>`EXISTS (SELECT 1 FROM mcp_server_secrets sec WHERE sec.mcp_server_id = mcp_servers.id)`,
  credentialHeader: sql<
    string | null
  >`(SELECT sec.header_name FROM mcp_server_secrets sec WHERE sec.mcp_server_id = mcp_servers.id)`,
  // Whether an OAuth authorization has been completed, and whether the server
  // has since asked for a wider scope. Never the token itself.
  hasOauthToken: sql<boolean>`EXISTS (SELECT 1 FROM mcp_oauth_tokens tok WHERE tok.mcp_server_id = mcp_servers.id)`,
  oauthNeedsScope: sql<
    string | null
  >`(SELECT tok.needs_scope FROM mcp_oauth_tokens tok WHERE tok.mcp_server_id = mcp_servers.id)`,
  grantedToolCount: sql<number>`(SELECT count(*) FROM mcp_tool_grants g WHERE g.mcp_server_id = mcp_servers.id)`.mapWith(Number),
  // Stale means the grant no longer matches a live tool: the tool changed, was
  // removed, or is gone entirely. Computed rather than read from
  // `mcp_tool_grants.state`, which is only a cache for display.
  staleGrantCount: sql<number>`(
    SELECT count(*) FROM mcp_tool_grants g
    LEFT JOIN mcp_server_tools t
      ON t.mcp_server_id = g.mcp_server_id AND t.name = g.tool_name AND t.removed_at IS NULL
    WHERE g.mcp_server_id = mcp_servers.id
      AND (t.id IS NULL OR t.content_hash <> g.approved_hash)
  )`.mapWith(Number),
};

type ServerRow = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  endpointUrl: string;
  transport: "http";
  authKind: McpAuthKind;
  status: McpServerStatus;
  lastProbeAt: Date | null;
  lastProbeOk: boolean | null;
  lastProbeMessage: string | null;
  toolCount: number;
  createdAt: Date;
  updatedAt: Date;
  hasCredential: boolean;
  credentialHeader: string | null;
  hasOauthToken: boolean;
  oauthNeedsScope: string | null;
  grantedToolCount: number;
  staleGrantCount: number;
};

function mapServer(row: ServerRow): McpServer {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    endpointUrl: row.endpointUrl,
    transport: row.transport,
    authKind: row.authKind,
    status: row.status,
    hasCredential: row.hasCredential,
    credentialHeader: row.credentialHeader,
    hasOauthToken: row.hasOauthToken,
    oauthNeedsScope: row.oauthNeedsScope,
    toolCount: row.toolCount,
    grantedToolCount: row.grantedToolCount,
    staleGrantCount: row.staleGrantCount,
    lastProbeAt: toIso(row.lastProbeAt),
    lastProbeOk: row.lastProbeOk,
    lastProbeMessage: row.lastProbeMessage,
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

export function toSummary(server: McpServer): McpServerSummary {
  // `workspaceId` and `credentialHeader` are dropped: the first is already
  // known to the caller, and the second is configuration detail a list does
  // not need. Neither is a secret, but a narrower payload is a smaller
  // mistake surface.
  const { workspaceId: _workspaceId, credentialHeader: _credentialHeader, ...summary } = server;
  return summary;
}

export async function listServers(workspaceId: string, client?: PoolClient): Promise<McpServer[]> {
  const rows = await withDb(
    (db) => db.select(serverSelection).from(mcpServers).where(eq(mcpServers.workspaceId, workspaceId)).orderBy(desc(mcpServers.updatedAt)),
    client,
  );
  return rows.map(mapServer);
}

export async function findServerById(workspaceId: string, serverId: string, client?: PoolClient): Promise<McpServer | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(serverSelection)
        .from(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), eq(mcpServers.id, serverId)))
        .limit(1),
    client,
  );
  return rows[0] ? mapServer(rows[0]) : null;
}

export async function findServerBySlug(workspaceId: string, slug: string, client?: PoolClient): Promise<McpServer | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(serverSelection)
        .from(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), eq(mcpServers.slug, slug)))
        .limit(1),
    client,
  );
  return rows[0] ? mapServer(rows[0]) : null;
}

export async function countServers(workspaceId: string, client?: PoolClient): Promise<number> {
  const rows = await withDb(
    (db) => db.select({ total: count() }).from(mcpServers).where(eq(mcpServers.workspaceId, workspaceId)),
    client,
  );
  return rows[0]?.total ?? 0;
}

export async function slugExists(workspaceId: string, slug: string, client?: PoolClient): Promise<boolean> {
  const rows = await withDb(
    (db) =>
      db
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), eq(mcpServers.slug, slug)))
        .limit(1),
    client,
  );
  return rows.length > 0;
}

export interface InsertServerInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  slug: string;
  endpointUrl: string;
  authKind: McpAuthKind;
}

export async function insertServer(input: InsertServerInput, client?: PoolClient): Promise<string> {
  const rows = await withDb(
    (db) =>
      db
        .insert(mcpServers)
        .values({
          workspaceId: input.workspaceId,
          createdBy: input.createdBy,
          name: input.name,
          slug: input.slug,
          endpointUrl: input.endpointUrl,
          authKind: input.authKind,
          transport: "http",
        })
        .returning({ id: mcpServers.id }),
    client,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Failed to insert MCP server");
  return id;
}

export interface ServerPatch {
  name?: string;
  endpointUrl?: string;
  authKind?: McpAuthKind;
  status?: McpServerStatus;
}

/**
 * Applies only the fields present.
 *
 * Changing the endpoint resets the probe result, because a stored "active"
 * would otherwise describe a server that is no longer the one configured.
 */
export async function updateServer(workspaceId: string, serverId: string, patch: ServerPatch, client?: PoolClient): Promise<void> {
  const values: Partial<typeof mcpServers.$inferInsert> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.authKind !== undefined) values.authKind = patch.authKind;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.endpointUrl !== undefined) {
    values.endpointUrl = patch.endpointUrl;
    values.status = patch.status ?? "draft";
    values.lastProbeAt = null;
    values.lastProbeOk = null;
    values.lastProbeMessage = null;
  }
  if (Object.keys(values).length === 0) return;

  await withDb(
    (db) => db.update(mcpServers).set(values).where(and(eq(mcpServers.workspaceId, workspaceId), eq(mcpServers.id, serverId))),
    client,
  );
}

export interface ProbeOutcome {
  ok: boolean;
  status: McpServerStatus;
  /** Already sanitised by the caller: host and condition only. */
  message: string;
  toolCount: number;
  checkedAt: Date;
}

export async function recordProbe(workspaceId: string, serverId: string, outcome: ProbeOutcome, client?: PoolClient): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(mcpServers)
        .set({
          status: outcome.status,
          lastProbeAt: outcome.checkedAt,
          lastProbeOk: outcome.ok,
          lastProbeMessage: outcome.message,
          toolCount: outcome.toolCount,
        })
        .where(and(eq(mcpServers.workspaceId, workspaceId), eq(mcpServers.id, serverId))),
    client,
  );
}

/** Removes the server. Secret, tools and grants follow through ON DELETE CASCADE. */
export async function deleteServer(workspaceId: string, serverId: string, client?: PoolClient): Promise<boolean> {
  const rows = await withDb(
    (db) =>
      db
        .delete(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), eq(mcpServers.id, serverId)))
        .returning({ id: mcpServers.id }),
    client,
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export async function upsertServerSecret(
  workspaceId: string,
  serverId: string,
  sealed: SealedSecret,
  headerName: string,
  client?: PoolClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .insert(mcpServerSecrets)
        .values({ workspaceId, mcpServerId: serverId, ...sealed, headerName })
        .onConflictDoUpdate({
          target: mcpServerSecrets.mcpServerId,
          set: { ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag, headerName, updatedAt: new Date() },
        }),
    client,
  );
}

export async function clearServerSecret(workspaceId: string, serverId: string, client?: PoolClient): Promise<void> {
  await withDb(
    (db) =>
      db
        .delete(mcpServerSecrets)
        .where(and(eq(mcpServerSecrets.workspaceId, workspaceId), eq(mcpServerSecrets.mcpServerId, serverId))),
    client,
  );
}

export interface StoredServerSecret extends SealedSecret {
  headerName: string;
}

/**
 * Reads the sealed envelope.
 *
 * Returns ciphertext, never plaintext: opening it requires the binding context
 * and is the service's job, so a repository mistake cannot leak a credential.
 */
export async function findServerSecret(workspaceId: string, serverId: string, client?: PoolClient): Promise<StoredServerSecret | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          ciphertext: mcpServerSecrets.ciphertext,
          iv: mcpServerSecrets.iv,
          tag: mcpServerSecrets.tag,
          headerName: mcpServerSecrets.headerName,
        })
        .from(mcpServerSecrets)
        .where(and(eq(mcpServerSecrets.workspaceId, workspaceId), eq(mcpServerSecrets.mcpServerId, serverId)))
        .limit(1),
    client,
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Discovered tools
// ---------------------------------------------------------------------------

type ToolRow = {
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: unknown;
  outputSchema: unknown;
  annotations: unknown;
  contentHash: string;
};

function mapTool(row: ToolRow): McpDiscoveredTool {
  return {
    name: row.name,
    title: row.title,
    description: row.description,
    inputSchema: (row.inputSchema ?? {}) as Record<string, unknown>,
    outputSchema: (row.outputSchema ?? null) as Record<string, unknown> | null,
    annotations: (row.annotations ?? {}) as McpDiscoveredTool["annotations"],
    contentHash: row.contentHash,
  };
}

/** Tools the server currently offers. Removed ones are excluded. */
export async function listServerTools(workspaceId: string, serverId: string, client?: PoolClient): Promise<McpDiscoveredTool[]> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          name: mcpServerTools.name,
          title: mcpServerTools.title,
          description: mcpServerTools.description,
          inputSchema: mcpServerTools.inputSchema,
          outputSchema: mcpServerTools.outputSchema,
          annotations: mcpServerTools.annotations,
          contentHash: mcpServerTools.contentHash,
        })
        .from(mcpServerTools)
        .where(
          and(
            eq(mcpServerTools.workspaceId, workspaceId),
            eq(mcpServerTools.mcpServerId, serverId),
            isNull(mcpServerTools.removedAt),
          ),
        )
        .orderBy(asc(mcpServerTools.name)),
    client,
  );
  return rows.map(mapTool);
}

/**
 * Replaces the snapshot for a server.
 *
 * Upsert then soft-remove, rather than delete then insert. `first_seen_at` is
 * worth keeping, and a hard delete would lose the row a grant's "orphaned"
 * explanation points at. Runs inside the caller's transaction so a partial
 * discovery cannot leave half a snapshot.
 */
export async function replaceServerTools(
  workspaceId: string,
  serverId: string,
  tools: ReadonlyArray<McpDiscoveredTool>,
  client: PoolClient,
): Promise<void> {
  const seenAt = new Date();

  if (tools.length > 0) {
    await withDb(
      (db) =>
        db
          .insert(mcpServerTools)
          .values(
            tools.map((tool) => ({
              workspaceId,
              mcpServerId: serverId,
              name: tool.name,
              title: tool.title,
              description: tool.description,
              inputSchema: tool.inputSchema,
              outputSchema: tool.outputSchema,
              annotations: tool.annotations,
              contentHash: tool.contentHash,
              lastSeenAt: seenAt,
              removedAt: null,
            })),
          )
          .onConflictDoUpdate({
            target: [mcpServerTools.mcpServerId, mcpServerTools.name],
            set: {
              title: sql`excluded.title`,
              description: sql`excluded.description`,
              inputSchema: sql`excluded.input_schema`,
              outputSchema: sql`excluded.output_schema`,
              annotations: sql`excluded.annotations`,
              contentHash: sql`excluded.content_hash`,
              lastSeenAt: seenAt,
              removedAt: null,
            },
          }),
      client,
    );
  }

  // Anything not in this discovery is marked removed. Done by timestamp rather
  // than by a name list so the statement size does not grow with the tool count.
  await withDb(
    (db) =>
      db
        .update(mcpServerTools)
        .set({ removedAt: seenAt })
        .where(
          and(
            eq(mcpServerTools.workspaceId, workspaceId),
            eq(mcpServerTools.mcpServerId, serverId),
            isNull(mcpServerTools.removedAt),
            sql`${mcpServerTools.lastSeenAt} < ${seenAt}`,
          ),
        ),
    client,
  );
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

export async function listGrants(workspaceId: string, serverId: string, client?: PoolClient): Promise<McpToolGrant[]> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          serverId: mcpToolGrants.mcpServerId,
          toolName: mcpToolGrants.toolName,
          approvedHash: mcpToolGrants.approvedHash,
          riskClass: mcpToolGrants.riskClass,
          requiresApproval: mcpToolGrants.requiresApproval,
          state: mcpToolGrants.state,
          grantedAt: mcpToolGrants.grantedAt,
        })
        .from(mcpToolGrants)
        .where(and(eq(mcpToolGrants.workspaceId, workspaceId), eq(mcpToolGrants.mcpServerId, serverId)))
        .orderBy(asc(mcpToolGrants.toolName)),
    client,
  );
  return rows.map((row) => ({ ...row, grantedAt: toIsoRequired(row.grantedAt) }));
}

/**
 * Servers, their live tools and their grants, for the slugs an agent attached.
 *
 * Three queries whatever the number of servers, because this runs on the hot
 * path of every agent turn: resolving one tool call must not cost a round trip
 * per connected server. Tools and grants come back grouped by server id.
 */
export interface ServerBundle {
  server: McpServer;
  tools: McpDiscoveredTool[];
  grants: McpToolGrant[];
}

export async function loadServerBundles(
  workspaceId: string,
  slugs: ReadonlyArray<string>,
  client?: PoolClient,
): Promise<ServerBundle[]> {
  const unique = [...new Set(slugs)].filter(Boolean);
  if (unique.length === 0) return [];

  const serverRows = await withDb(
    (db) =>
      db
        .select(serverSelection)
        .from(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), inArray(mcpServers.slug, unique))),
    client,
  );
  if (serverRows.length === 0) return [];

  const servers = serverRows.map(mapServer);
  const ids = servers.map((server) => server.id);

  const [toolRows, grantRows] = await Promise.all([
    withDb(
      (db) =>
        db
          .select({
            mcpServerId: mcpServerTools.mcpServerId,
            name: mcpServerTools.name,
            title: mcpServerTools.title,
            description: mcpServerTools.description,
            inputSchema: mcpServerTools.inputSchema,
            outputSchema: mcpServerTools.outputSchema,
            annotations: mcpServerTools.annotations,
            contentHash: mcpServerTools.contentHash,
          })
          .from(mcpServerTools)
          .where(
            and(
              eq(mcpServerTools.workspaceId, workspaceId),
              inArray(mcpServerTools.mcpServerId, ids),
              isNull(mcpServerTools.removedAt),
            ),
          )
          .orderBy(asc(mcpServerTools.name)),
      client,
    ),
    withDb(
      (db) =>
        db
          .select({
            serverId: mcpToolGrants.mcpServerId,
            toolName: mcpToolGrants.toolName,
            approvedHash: mcpToolGrants.approvedHash,
            riskClass: mcpToolGrants.riskClass,
            requiresApproval: mcpToolGrants.requiresApproval,
            state: mcpToolGrants.state,
            grantedAt: mcpToolGrants.grantedAt,
          })
          .from(mcpToolGrants)
          .where(and(eq(mcpToolGrants.workspaceId, workspaceId), inArray(mcpToolGrants.mcpServerId, ids)))
          .orderBy(asc(mcpToolGrants.toolName)),
      client,
    ),
  ]);

  return servers.map((server) => ({
    server,
    tools: toolRows.filter((row) => row.mcpServerId === server.id).map(mapTool),
    grants: grantRows
      .filter((row) => row.serverId === server.id)
      .map((row) => ({ ...row, grantedAt: toIsoRequired(row.grantedAt) })),
  }));
}

export interface GrantInput {
  toolName: string;
  approvedHash: string;
  riskClass: McpRiskClass;
  requiresApproval: boolean;
}

/**
 * Sets the grants for a server to exactly this list.
 *
 * A grant absent from the list is revoked. That is the intended semantics of
 * the approval screen: it submits the complete decision, so unticking a box
 * removes the grant rather than leaving a stale one behind.
 *
 * `requiresApproval` is written as the caller supplied it, and the database's
 * CHECK constraint refuses a destructive grant that does not require approval.
 * The service normalises it first; the constraint is there for the path that
 * forgets to.
 */
export async function replaceGrants(
  workspaceId: string,
  serverId: string,
  grants: ReadonlyArray<GrantInput>,
  grantedBy: string,
  client: PoolClient,
): Promise<void> {
  const keep = grants.map((grant) => grant.toolName);

  const conditions: Array<SQL | undefined> = [eq(mcpToolGrants.workspaceId, workspaceId), eq(mcpToolGrants.mcpServerId, serverId)];
  if (keep.length > 0) {
    // `notInArray`, not a hand-written `<> ALL(...)`: interpolating a JS array
    // into a template expands it into separate bind parameters rather than a
    // PostgreSQL array, which fails at run time with 22P02 or 42809.
    conditions.push(notInArray(mcpToolGrants.toolName, keep));
  }
  await withDb((db) => db.delete(mcpToolGrants).where(and(...conditions)), client);

  if (grants.length === 0) return;

  await withDb(
    (db) =>
      db
        .insert(mcpToolGrants)
        .values(
          grants.map((grant) => ({
            workspaceId,
            mcpServerId: serverId,
            toolName: grant.toolName,
            approvedHash: grant.approvedHash,
            riskClass: grant.riskClass,
            requiresApproval: grant.requiresApproval,
            state: "active" as const,
            grantedBy,
            grantedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [mcpToolGrants.mcpServerId, mcpToolGrants.toolName],
          set: {
            approvedHash: sql`excluded.approved_hash`,
            riskClass: sql`excluded.risk_class`,
            requiresApproval: sql`excluded.requires_approval`,
            state: sql`excluded.state`,
            grantedBy: sql`excluded.granted_by`,
            grantedAt: sql`excluded.granted_at`,
          },
        }),
    client,
  );
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export interface OauthStateInsert {
  workspaceId: string;
  mcpServerId: string;
  state: string;
  verifier: SealedSecret;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scope: string | null;
  resource: string;
  redirectUri: string;
  createdBy: string | null;
  expiresAt: Date;
}

export async function insertOauthState(input: OauthStateInsert, client?: PoolClient): Promise<void> {
  await withDb(
    (db) =>
      db.insert(mcpOauthStates).values({
        workspaceId: input.workspaceId,
        mcpServerId: input.mcpServerId,
        state: input.state,
        verifierCiphertext: input.verifier.ciphertext,
        verifierIv: input.verifier.iv,
        verifierTag: input.verifier.tag,
        issuer: input.issuer,
        authorizationEndpoint: input.authorizationEndpoint,
        tokenEndpoint: input.tokenEndpoint,
        clientId: input.clientId,
        scope: input.scope,
        resource: input.resource,
        redirectUri: input.redirectUri,
        createdBy: input.createdBy,
        expiresAt: input.expiresAt,
      }),
    client,
  );
}

export interface StoredOauthState {
  workspaceId: string;
  mcpServerId: string;
  verifier: SealedSecret;
  issuer: string;
  tokenEndpoint: string;
  clientId: string;
  scope: string | null;
  resource: string;
  redirectUri: string;
  expiresAt: Date;
}

/**
 * Redeems a state value, removing it in the same statement.
 *
 * A DELETE ... RETURNING rather than a read then a delete: the state is a
 * single-use CSRF token, and two concurrent callbacks carrying the same state
 * must not both find it. The row is deleted even when it turns out to be
 * expired, because an expired state is spent either way.
 *
 * Deliberately NOT scoped by workspace: the caller is a browser coming back
 * from an authorization server and has no workspace context yet. The state
 * value *is* the credential here, and the row is what tells us which workspace
 * it belongs to.
 */
export async function redeemOauthState(state: string, client?: PoolClient): Promise<StoredOauthState | null> {
  const rows = await withDb(
    (db) =>
      db
        .delete(mcpOauthStates)
        .where(eq(mcpOauthStates.state, state))
        .returning({
          workspaceId: mcpOauthStates.workspaceId,
          mcpServerId: mcpOauthStates.mcpServerId,
          ciphertext: mcpOauthStates.verifierCiphertext,
          iv: mcpOauthStates.verifierIv,
          tag: mcpOauthStates.verifierTag,
          issuer: mcpOauthStates.issuer,
          tokenEndpoint: mcpOauthStates.tokenEndpoint,
          clientId: mcpOauthStates.clientId,
          scope: mcpOauthStates.scope,
          resource: mcpOauthStates.resource,
          redirectUri: mcpOauthStates.redirectUri,
          expiresAt: mcpOauthStates.expiresAt,
        }),
    client,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    workspaceId: row.workspaceId,
    mcpServerId: row.mcpServerId,
    verifier: { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag },
    issuer: row.issuer,
    tokenEndpoint: row.tokenEndpoint,
    clientId: row.clientId,
    scope: row.scope,
    resource: row.resource,
    redirectUri: row.redirectUri,
    expiresAt: row.expiresAt,
  };
}

/** Clears abandoned authorizations for a server before starting another. */
export async function deleteOauthStates(workspaceId: string, serverId: string, client?: PoolClient): Promise<void> {
  await withDb(
    (db) =>
      db
        .delete(mcpOauthStates)
        .where(and(eq(mcpOauthStates.workspaceId, workspaceId), eq(mcpOauthStates.mcpServerId, serverId))),
    client,
  );
}

export interface OauthTokenRecord {
  issuer: string;
  tokenEndpoint: string;
  clientId: string;
  /** The resource this token was minted for. Reused verbatim on refresh. */
  resource: string;
  scope: string | null;
  access: SealedSecret;
  accessExpiresAt: Date | null;
  refresh: SealedSecret | null;
  needsScope: string | null;
}

export async function findOauthToken(workspaceId: string, serverId: string, client?: PoolClient): Promise<OauthTokenRecord | null> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          issuer: mcpOauthTokens.issuer,
          tokenEndpoint: mcpOauthTokens.tokenEndpoint,
          clientId: mcpOauthTokens.clientId,
          resource: mcpOauthTokens.resource,
          scope: mcpOauthTokens.scope,
          accessCiphertext: mcpOauthTokens.accessCiphertext,
          accessIv: mcpOauthTokens.accessIv,
          accessTag: mcpOauthTokens.accessTag,
          accessExpiresAt: mcpOauthTokens.accessExpiresAt,
          refreshCiphertext: mcpOauthTokens.refreshCiphertext,
          refreshIv: mcpOauthTokens.refreshIv,
          refreshTag: mcpOauthTokens.refreshTag,
          needsScope: mcpOauthTokens.needsScope,
        })
        .from(mcpOauthTokens)
        .where(and(eq(mcpOauthTokens.workspaceId, workspaceId), eq(mcpOauthTokens.mcpServerId, serverId)))
        .limit(1),
    client,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    issuer: row.issuer,
    tokenEndpoint: row.tokenEndpoint,
    clientId: row.clientId,
    resource: row.resource,
    scope: row.scope,
    access: { ciphertext: row.accessCiphertext, iv: row.accessIv, tag: row.accessTag },
    accessExpiresAt: row.accessExpiresAt,
    refresh:
      row.refreshCiphertext && row.refreshIv && row.refreshTag
        ? { ciphertext: row.refreshCiphertext, iv: row.refreshIv, tag: row.refreshTag }
        : null,
    needsScope: row.needsScope,
  };
}

export interface UpsertOauthTokenInput {
  workspaceId: string;
  mcpServerId: string;
  issuer: string;
  tokenEndpoint: string;
  clientId: string;
  resource: string;
  scope: string | null;
  access: SealedSecret;
  accessExpiresAt: Date | null;
  refresh: SealedSecret | null;
  authorizedBy: string | null;
}

/** One token set per server; re-authorizing replaces it rather than accumulating. */
export async function upsertOauthToken(input: UpsertOauthTokenInput, client?: PoolClient): Promise<void> {
  await withDb(
    (db) =>
      db
        .insert(mcpOauthTokens)
        .values({
          workspaceId: input.workspaceId,
          mcpServerId: input.mcpServerId,
          issuer: input.issuer,
          tokenEndpoint: input.tokenEndpoint,
          clientId: input.clientId,
          resource: input.resource,
          scope: input.scope,
          accessCiphertext: input.access.ciphertext,
          accessIv: input.access.iv,
          accessTag: input.access.tag,
          accessExpiresAt: input.accessExpiresAt,
          refreshCiphertext: input.refresh?.ciphertext ?? null,
          refreshIv: input.refresh?.iv ?? null,
          refreshTag: input.refresh?.tag ?? null,
          // A fresh authorization clears any recorded scope shortfall.
          needsScope: null,
          authorizedBy: input.authorizedBy,
        })
        .onConflictDoUpdate({
          target: mcpOauthTokens.mcpServerId,
          set: {
            issuer: sql`excluded.issuer`,
            tokenEndpoint: sql`excluded.token_endpoint`,
            clientId: sql`excluded.client_id`,
            resource: sql`excluded.resource`,
            scope: sql`excluded.scope`,
            accessCiphertext: sql`excluded.access_ciphertext`,
            accessIv: sql`excluded.access_iv`,
            accessTag: sql`excluded.access_tag`,
            accessExpiresAt: sql`excluded.access_expires_at`,
            refreshCiphertext: sql`excluded.refresh_ciphertext`,
            refreshIv: sql`excluded.refresh_iv`,
            refreshTag: sql`excluded.refresh_tag`,
            needsScope: sql`excluded.needs_scope`,
            authorizedBy: sql`excluded.authorized_by`,
            updatedAt: new Date(),
          },
        }),
    client,
  );
}

/** Records that the server wants a wider scope than we hold. */
export async function recordOauthScopeShortfall(
  workspaceId: string,
  serverId: string,
  needsScope: string | null,
  client?: PoolClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(mcpOauthTokens)
        .set({ needsScope, updatedAt: new Date() })
        .where(and(eq(mcpOauthTokens.workspaceId, workspaceId), eq(mcpOauthTokens.mcpServerId, serverId))),
    client,
  );
}

export async function deleteOauthToken(workspaceId: string, serverId: string, client?: PoolClient): Promise<void> {
  await withDb(
    (db) =>
      db
        .delete(mcpOauthTokens)
        .where(and(eq(mcpOauthTokens.workspaceId, workspaceId), eq(mcpOauthTokens.mcpServerId, serverId))),
    client,
  );
}

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

export interface ToolCallInsert {
  workspaceId: string;
  mcpServerId: string | null;
  agentId: string | null;
  conversationId: string | null;
  toolRef: string;
  toolName: string;
  status: McpCallStatus;
  resolution: McpResolutionStatus;
  riskClass: McpRiskClass | null;
  /** The pin in force when the call was decided, copied rather than joined. */
  approvedHash: string | null;
  arguments: Record<string, unknown>;
  requestedBy: string | null;
}

/** Records a decision about a call. Every decision, refusals included. */
export async function insertToolCall(input: ToolCallInsert, client?: PoolClient): Promise<string> {
  const rows = await withDb(
    (db) =>
      db
        .insert(mcpToolCalls)
        .values({
          workspaceId: input.workspaceId,
          mcpServerId: input.mcpServerId,
          agentId: input.agentId,
          conversationId: input.conversationId,
          toolRef: input.toolRef,
          toolName: input.toolName,
          status: input.status,
          resolution: input.resolution,
          riskClass: input.riskClass,
          approvedHash: input.approvedHash,
          arguments: input.arguments,
          requestedBy: input.requestedBy,
        })
        .returning({ id: mcpToolCalls.id }),
    client,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Failed to record MCP tool call");
  return id;
}

export interface ToolCallCompletion {
  status: Extract<McpCallStatus, "executed" | "failed">;
  result: unknown;
  resultBytes: number | null;
  resultTruncated: boolean;
  isError: boolean;
  errorMessage: string | null;
  durationMs: number;
}

/** Closes a call that was actually attempted. */
export async function completeToolCall(
  workspaceId: string,
  callId: string,
  completion: ToolCallCompletion,
  client?: PoolClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(mcpToolCalls)
        .set({
          status: completion.status,
          result: completion.result === null ? null : (completion.result as Record<string, unknown>),
          resultBytes: completion.resultBytes,
          resultTruncated: completion.resultTruncated,
          isError: completion.isError,
          errorMessage: completion.errorMessage,
          durationMs: completion.durationMs,
          updatedAt: new Date(),
        })
        .where(and(eq(mcpToolCalls.workspaceId, workspaceId), eq(mcpToolCalls.id, callId))),
    client,
  );
}

const callSelection = {
  id: mcpToolCalls.id,
  serverId: mcpToolCalls.mcpServerId,
  serverName: mcpServers.name,
  agentId: mcpToolCalls.agentId,
  agentName: agents.name,
  conversationId: mcpToolCalls.conversationId,
  toolRef: mcpToolCalls.toolRef,
  toolName: mcpToolCalls.toolName,
  status: mcpToolCalls.status,
  resolution: mcpToolCalls.resolution,
  riskClass: mcpToolCalls.riskClass,
  arguments: mcpToolCalls.arguments,
  result: mcpToolCalls.result,
  resultBytes: mcpToolCalls.resultBytes,
  resultTruncated: mcpToolCalls.resultTruncated,
  isError: mcpToolCalls.isError,
  errorMessage: mcpToolCalls.errorMessage,
  durationMs: mcpToolCalls.durationMs,
  decidedAt: mcpToolCalls.decidedAt,
  createdAt: mcpToolCalls.createdAt,
};

type CallRow = {
  id: string;
  serverId: string | null;
  serverName: string | null;
  agentId: string | null;
  agentName: string | null;
  conversationId: string | null;
  toolRef: string;
  toolName: string;
  status: McpCallStatus;
  resolution: McpResolutionStatus;
  riskClass: McpRiskClass | null;
  arguments: unknown;
  result: unknown;
  resultBytes: number | null;
  resultTruncated: boolean;
  isError: boolean;
  errorMessage: string | null;
  durationMs: number | null;
  decidedAt: Date | null;
  createdAt: Date;
};

function mapCall(row: CallRow): McpToolCall {
  return { ...row, decidedAt: toIso(row.decidedAt), createdAt: toIsoRequired(row.createdAt) };
}

/**
 * The calls waiting for a person, oldest first.
 *
 * Oldest first deliberately: a queue somebody works through should not
 * reorder itself as new requests arrive.
 */
export async function listPendingToolCalls(workspaceId: string, limit = 100, client?: PoolClient): Promise<McpToolCall[]> {
  const rows = await withDb(
    (db) =>
      db
        .select(callSelection)
        .from(mcpToolCalls)
        .leftJoin(mcpServers, eq(mcpServers.id, mcpToolCalls.mcpServerId))
        .leftJoin(agents, eq(agents.id, mcpToolCalls.agentId))
        .where(and(eq(mcpToolCalls.workspaceId, workspaceId), eq(mcpToolCalls.status, "awaiting_approval")))
        .orderBy(asc(mcpToolCalls.createdAt))
        .limit(limit),
    client,
  );
  return rows.map(mapCall);
}

/** Recent calls for the audit view, newest first. */
export async function listRecentToolCalls(workspaceId: string, limit = 50, client?: PoolClient): Promise<McpToolCall[]> {
  const rows = await withDb(
    (db) =>
      db
        .select(callSelection)
        .from(mcpToolCalls)
        .leftJoin(mcpServers, eq(mcpServers.id, mcpToolCalls.mcpServerId))
        .leftJoin(agents, eq(agents.id, mcpToolCalls.agentId))
        .where(eq(mcpToolCalls.workspaceId, workspaceId))
        .orderBy(desc(mcpToolCalls.createdAt))
        .limit(limit),
    client,
  );
  return rows.map(mapCall);
}

export async function findToolCallById(workspaceId: string, callId: string, client?: PoolClient): Promise<McpToolCall | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(callSelection)
        .from(mcpToolCalls)
        .leftJoin(mcpServers, eq(mcpServers.id, mcpToolCalls.mcpServerId))
        .leftJoin(agents, eq(agents.id, mcpToolCalls.agentId))
        .where(and(eq(mcpToolCalls.workspaceId, workspaceId), eq(mcpToolCalls.id, callId)))
        .limit(1),
    client,
  );
  return rows[0] ? mapCall(rows[0]) : null;
}

/**
 * Moves a queued call out of the queue.
 *
 * Conditional on the row still being `awaiting_approval`, and it reports
 * whether it changed anything. Two reviewers opening the same queue is
 * ordinary, and the second must not be able to re-decide a call or to approve
 * one that has already run.
 */
export async function decideToolCall(
  workspaceId: string,
  callId: string,
  decision: {
    status: Extract<McpCallStatus, "denied" | "running" | "refused" | "expired">;
    decidedBy: string;
    /** Why, when a person said yes but the call can no longer be allowed. */
    errorMessage?: string | null;
  },
  client?: PoolClient,
): Promise<boolean> {
  const rows = await withDb(
    (db) =>
      db
        .update(mcpToolCalls)
        .set({
          status: decision.status,
          decidedBy: decision.decidedBy,
          decidedAt: new Date(),
          updatedAt: new Date(),
          ...(decision.errorMessage === undefined ? {} : { errorMessage: decision.errorMessage }),
        })
        .where(
          and(
            eq(mcpToolCalls.workspaceId, workspaceId),
            eq(mcpToolCalls.id, callId),
            eq(mcpToolCalls.status, "awaiting_approval"),
          ),
        )
        .returning({ id: mcpToolCalls.id }),
    client,
  );
  return rows.length > 0;
}
