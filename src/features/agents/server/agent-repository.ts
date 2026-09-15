import "server-only";

import { and, count, desc, eq, ilike, inArray, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";

import { DEFAULT_MEMORY_CONFIG, DEFAULT_MODEL_CONFIG } from "@/features/agents/constants";
import { parseDelegationConfig } from "@/features/agents/delegation-limits";
import { normalizeToolSettings } from "@/features/agents/tools/registry";
import { normalizeAgentMcpTools, type AgentMcpToolAttachment } from "@/features/mcp/agent-attachment";
import type {
  Agent,
  AgentKnowledgeOption,
  AgentListFilters,
  AgentMemoryConfig,
  AgentModelConfig,
  AgentOutputSchema,
  AgentOverview,
  AgentStatus,
  AgentSummary,
  AgentToolSetting,
  DelegationCandidate,
  DelegationTarget,
} from "@/features/agents/types";
import { queryOne, withDb, type DatabaseClient } from "@/server/db/client";
import {
  agentCollections,
  agentDelegations,
  agents,
  conversations,
  knowledgeCollections,
  knowledgeSources,
} from "@/server/db/schema";
import { likePattern, normalizePage, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

/** Connection-less builder, used only to COMPOSE correlated subqueries. */
const qb = new QueryBuilder();

interface AgentRow {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  instructions: string;
  modelConfig: unknown;
  tools: unknown;
  memoryConfig: unknown;
  outputSchema: unknown;
  requiresApproval: boolean;
  canDelegate: boolean;
  delegationConfig: unknown;
  createdAt: Date;
  updatedAt: Date;
  conversationCount: number;
  collectionIds: string[] | null;
  delegateIds: string[] | null;
}

/**
 * Columns every agent read returns, including the three derived aggregates.
 *
 * The two `array_agg` subqueries collect a child table's ids into one array
 * column, which is what keeps a list of agents a single statement rather than a
 * query per row.
 *
 * All three are COMPOSED with the query builder rather than written as one
 * `sql` template, and that is load-bearing: in a select list with no join,
 * Drizzle renders an interpolated column without its table name, so a template
 * would emit `WHERE "agent_id" = "id"` - both columns of the INNER table, which
 * silently aggregates the wrong rows. Composed this way the outer reference
 * stays qualified as `"agents"."id"`.
 */
const agentSelection = {
  id: agents.id,
  workspaceId: agents.workspaceId,
  name: agents.name,
  description: agents.description,
  status: agents.status,
  instructions: agents.instructions,
  modelConfig: agents.modelConfig,
  tools: agents.tools,
  memoryConfig: agents.memoryConfig,
  outputSchema: agents.outputSchema,
  requiresApproval: agents.requiresApproval,
  canDelegate: agents.canDelegate,
  delegationConfig: agents.delegationConfig,
  createdAt: agents.createdAt,
  updatedAt: agents.updatedAt,
  conversationCount: sql<number>`${qb
    .select({ c: sql`count(*)` })
    .from(conversations)
    .where(eq(conversations.agentId, agents.id))}`.mapWith(Number),
  collectionIds: sql<string[] | null>`${qb
    .select({ ids: sql`array_agg(${agentCollections.collectionId})` })
    .from(agentCollections)
    .where(eq(agentCollections.agentId, agents.id))}`,
  delegateIds: sql<string[] | null>`${qb
    .select({ ids: sql`array_agg(${agentDelegations.childAgentId})` })
    .from(agentDelegations)
    .where(and(eq(agentDelegations.supervisorAgentId, agents.id), eq(agentDelegations.enabled, true)))}`,
};

function mapAgent(row: AgentRow): Agent {
  const collectionIds = row.collectionIds ?? [];
  const delegateIds = row.delegateIds ?? [];
  const tools = normalizeToolSettings(row.tools);
  const mcpTools = normalizeAgentMcpTools(row.tools);
  return {
    canDelegate: row.canDelegate,
    delegateIds,
    delegateCount: delegateIds.length,
    // Parsed and clamped on every read, so a hand-edited row cannot raise a limit.
    delegationConfig: parseDelegationConfig(row.delegationConfig),
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    status: row.status,
    instructions: row.instructions,
    // jsonb is `unknown` by design: the database does not enforce its shape, so
    // these defaults are what make a partially written blob safe to use.
    modelConfig: { ...DEFAULT_MODEL_CONFIG, ...((row.modelConfig ?? {}) as Partial<AgentModelConfig>) },
    tools,
    mcpTools,
    memoryConfig: { ...DEFAULT_MEMORY_CONFIG, ...((row.memoryConfig ?? {}) as Partial<AgentMemoryConfig>) },
    outputSchema: (row.outputSchema ?? null) as AgentOutputSchema | null,
    requiresApproval: row.requiresApproval,
    collectionIds,
    collectionCount: collectionIds.length,
    enabledToolCount: tools.filter((tool) => tool.enabled).length,
    conversationCount: Number(row.conversationCount ?? 0),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

function toSummary(agent: Agent): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    status: agent.status,
    conversationCount: agent.conversationCount,
    collectionCount: agent.collectionCount,
    enabledToolCount: agent.enabledToolCount,
    requiresApproval: agent.requiresApproval,
    canDelegate: agent.canDelegate,
    delegateCount: agent.delegateCount,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

export async function listAgents(workspaceId: string, filters: AgentListFilters): Promise<Paginated<AgentSummary>> {
  const page = normalizePage(filters);

  // Built once and used by both the page query and the count, so the two can
  // never drift apart - which the old positional-parameter slicing allowed.
  const conditions: Array<SQL | undefined> = [
    eq(agents.workspaceId, workspaceId),
    filters.status ? eq(agents.status, filters.status) : ne(agents.status, "archived"),
  ];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conditions.push(or(ilike(agents.name, pattern), ilike(agents.description, pattern)));
  }
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db.select(agentSelection).from(agents).where(where).orderBy(desc(agents.updatedAt)).limit(page.pageSize).offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(agents).where(where)),
  ]);

  return toPaginated(rows.map(mapAgent).map(toSummary), totals[0]?.total ?? 0, page);
}

export async function findAgentById(workspaceId: string, agentId: string, client?: DatabaseClient): Promise<Agent | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(agentSelection)
        .from(agents)
        .where(and(eq(agents.workspaceId, workspaceId), eq(agents.id, agentId)))
        .limit(1),
    client,
  );
  return rows[0] ? mapAgent(rows[0]) : null;
}

export interface InsertAgentInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  description: string | null;
  modelConfig: AgentModelConfig;
  memoryConfig: AgentMemoryConfig;
  canDelegate: boolean;
}

export async function insertAgent(input: InsertAgentInput, client?: DatabaseClient): Promise<Agent> {
  const inserted = await withDb(
    (db) =>
      db
        .insert(agents)
        .values({
          workspaceId: input.workspaceId,
          createdBy: input.createdBy,
          name: input.name,
          description: input.description,
          modelConfig: input.modelConfig,
          memoryConfig: input.memoryConfig,
          canDelegate: input.canDelegate,
        })
        .returning({ id: agents.id }),
    client,
  );
  const id = inserted[0]?.id;
  if (!id) throw new Error("Failed to insert agent");
  const agent = await findAgentById(input.workspaceId, id, client);
  if (!agent) throw new Error("Agent vanished after insert");
  return agent;
}

export interface AgentPatch {
  name?: string;
  description?: string | null;
  instructions?: string;
  status?: AgentStatus;
  modelConfig?: AgentModelConfig;
  /**
   * The WHOLE `tools` jsonb array, both halves. Never just the built-in
   * settings: this column is replaced outright, so writing one half erases the
   * other. `updateAgent` composes it.
   */
  tools?: Array<AgentToolSetting | AgentMcpToolAttachment>;
  memoryConfig?: AgentMemoryConfig;
  outputSchema?: AgentOutputSchema | null;
  requiresApproval?: boolean;
  canDelegate?: boolean;
  /** Already parsed and clamped by the service; stored as given. */
  delegationConfig?: Record<string, number>;
}

export async function updateAgentRow(
  workspaceId: string,
  agentId: string,
  patch: AgentPatch,
  client?: DatabaseClient,
): Promise<void> {
  // Only the keys actually present are written, so an absent field keeps its
  // stored value. The jsonb columns are handed over as values, not as text:
  // the column type serialises them, which is what stops a JavaScript array
  // being encoded as a PostgreSQL array literal.
  const values: Partial<typeof agents.$inferInsert> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.instructions !== undefined) values.instructions = patch.instructions;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.modelConfig !== undefined) values.modelConfig = patch.modelConfig;
  if (patch.tools !== undefined) values.tools = patch.tools;
  if (patch.memoryConfig !== undefined) values.memoryConfig = patch.memoryConfig;
  if (patch.outputSchema !== undefined) values.outputSchema = patch.outputSchema;
  if (patch.requiresApproval !== undefined) values.requiresApproval = patch.requiresApproval;
  if (patch.canDelegate !== undefined) values.canDelegate = patch.canDelegate;
  if (patch.delegationConfig !== undefined) values.delegationConfig = patch.delegationConfig;
  if (Object.keys(values).length === 0) return;

  await withDb(
    (db) => db.update(agents).set(values).where(and(eq(agents.workspaceId, workspaceId), eq(agents.id, agentId))),
    client,
  );
}

export async function replaceAgentKnowledgeBases(
  workspaceId: string,
  agentId: string,
  collectionIds: string[],
  client: DatabaseClient,
): Promise<void> {
  await withDb(
    (db) => db.delete(agentCollections).where(and(eq(agentCollections.workspaceId, workspaceId), eq(agentCollections.agentId, agentId))),
    client,
  );
  if (collectionIds.length === 0) return;
  await withDb(
    (db) => db.insert(agentCollections).values(collectionIds.map((collectionId) => ({ agentId, collectionId, workspaceId }))),
    client,
  );
}

/** Tenancy guard: collections may only be attached from the caller's workspace. */
export async function countWorkspaceKnowledgeBases(workspaceId: string, ids: string[], client?: DatabaseClient): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await withDb(
    (db) =>
      db
        .select({ total: count() })
        .from(knowledgeCollections)
        .where(and(eq(knowledgeCollections.workspaceId, workspaceId), inArray(knowledgeCollections.id, ids))),
    client,
  );
  return rows[0]?.total ?? 0;
}

export async function deleteAgentRow(workspaceId: string, agentId: string): Promise<boolean> {
  const rows = await withDb((db) =>
    db
      .delete(agents)
      .where(and(eq(agents.workspaceId, workspaceId), eq(agents.id, agentId)))
      .returning({ id: agents.id }),
  );
  return rows.length > 0;
}

/**
 * The agents this supervisor has been granted, for the runtime.
 *
 * Joined to `agents` rather than read from the grant alone, because the runtime
 * needs the child's current name and status: a grant to an agent that has since
 * been archived must not be offered to a model.
 */
export async function listDelegationTargets(
  workspaceId: string,
  supervisorAgentId: string,
  client?: DatabaseClient,
): Promise<DelegationTarget[]> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          id: agents.id,
          name: agents.name,
          description: agents.description,
          status: agents.status,
          enabled: agentDelegations.enabled,
          canDelegate: agents.canDelegate,
        })
        .from(agentDelegations)
        .innerJoin(
          agents,
          and(eq(agents.id, agentDelegations.childAgentId), eq(agents.workspaceId, agentDelegations.workspaceId)),
        )
        .where(and(eq(agentDelegations.workspaceId, workspaceId), eq(agentDelegations.supervisorAgentId, supervisorAgentId)))
        .orderBy(agents.name),
    client,
  );
  return rows;
}

/**
 * Every agent in the workspace that could be granted, with its current grant.
 *
 * The supervisor itself is excluded here as well as by the database CHECK, so
 * the picker cannot offer a choice the write would then reject.
 */
export async function listDelegationCandidates(workspaceId: string, supervisorAgentId: string): Promise<DelegationCandidate[]> {
  const rows = await withDb((db) =>
    db
      .select({
        id: agents.id,
        name: agents.name,
        description: agents.description,
        status: agents.status,
        canDelegate: agents.canDelegate,
        granted: sql<boolean>`(${agentDelegations.childAgentId} IS NOT NULL)`,
        enabled: agentDelegations.enabled,
      })
      .from(agents)
      .leftJoin(
        agentDelegations,
        and(
          eq(agentDelegations.childAgentId, agents.id),
          eq(agentDelegations.supervisorAgentId, supervisorAgentId),
          eq(agentDelegations.workspaceId, agents.workspaceId),
        ),
      )
      .where(and(eq(agents.workspaceId, workspaceId), ne(agents.id, supervisorAgentId), ne(agents.status, "archived")))
      .orderBy(agents.name),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    canDelegate: row.canDelegate,
    granted: row.granted,
    enabled: row.enabled ?? false,
  }));
}

/**
 * Sets which agents this supervisor may delegate to.
 *
 * Removing a grant DISABLES it rather than deleting it, which is what the
 * `enabled` column is for: an agent taken out of a supervisor's reach usually
 * goes back in, and a disabled grant is refused at delegation time exactly like
 * a missing one. The row also remains as evidence that the relationship once
 * existed, which a deleted row would not.
 */
export async function setAgentDelegations(
  workspaceId: string,
  supervisorAgentId: string,
  childAgentIds: string[],
  client: DatabaseClient,
): Promise<void> {
  if (childAgentIds.length > 0) {
    await withDb(
      (db) =>
        db
          .insert(agentDelegations)
          .values(
            childAgentIds.map((childAgentId) => ({
              supervisorAgentId,
              childAgentId,
              workspaceId,
              enabled: true,
            })),
          )
          .onConflictDoUpdate({
            target: [agentDelegations.supervisorAgentId, agentDelegations.childAgentId],
            set: { enabled: true },
          }),
      client,
    );
  }
  // Everything still enabled that is no longer in the list. An empty list
  // disables every grant, which `notInArray` preserves: with no values it is
  // the constant true, exactly as `<> ALL('{}')` was.
  await withDb(
    (db) =>
      db
        .update(agentDelegations)
        .set({ enabled: false })
        .where(
          and(
            eq(agentDelegations.workspaceId, workspaceId),
            eq(agentDelegations.supervisorAgentId, supervisorAgentId),
            eq(agentDelegations.enabled, true),
            notInArray(agentDelegations.childAgentId, childAgentIds),
          ),
        ),
    client,
  );
}

/**
 * Tenancy guard for grants: every id must be a non-archived agent in this
 * workspace, and never the supervisor itself.
 */
export async function countGrantableAgents(
  workspaceId: string,
  supervisorAgentId: string,
  ids: string[],
  client?: DatabaseClient,
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await withDb(
    (db) =>
      db
        .select({ total: count() })
        .from(agents)
        .where(
          and(
            eq(agents.workspaceId, workspaceId),
            inArray(agents.id, ids),
            ne(agents.id, supervisorAgentId),
            ne(agents.status, "archived"),
          ),
        ),
    client,
  );
  return rows[0]?.total ?? 0;
}

export async function listKnowledgeOptions(workspaceId: string, agentId: string): Promise<AgentKnowledgeOption[]> {
  const rows = await withDb((db) =>
    db
      .select({
        id: knowledgeCollections.id,
        name: knowledgeCollections.name,
        status: knowledgeCollections.status,
        sourceCount: sql<number>`${qb
          .select({ c: sql`count(*)` })
          .from(knowledgeSources)
          .where(eq(knowledgeSources.collectionId, knowledgeCollections.id))}`.mapWith(Number),
        attached: sql<boolean>`EXISTS ${qb
          .select({ one: sql`1` })
          .from(agentCollections)
          .where(
            and(eq(agentCollections.collectionId, knowledgeCollections.id), eq(agentCollections.agentId, agentId)),
          )}`,
      })
      .from(knowledgeCollections)
      .where(eq(knowledgeCollections.workspaceId, workspaceId))
      .orderBy(knowledgeCollections.name),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    sourceCount: row.sourceCount,
    attached: row.attached,
  }));
}

/**
 * Overview counters.
 *
 * The four window counts are left as one raw statement on purpose: they are
 * four correlated date-window aggregates answered in a single round trip, and a
 * builder would turn that into more code producing the same string. The recent
 * conversations beside them are an ordinary read and go through Drizzle.
 */
export async function getAgentOverview(workspaceId: string, agentId: string): Promise<AgentOverview> {
  const [counts, recent] = await Promise.all([
    queryOne<{ conv_7: string; conv_prev: string; msg_7: string; msg_prev: string }>(
      `SELECT
         (SELECT count(*) FROM conversations WHERE workspace_id = $1 AND agent_id = $2 AND created_at >= now() - interval '7 days') AS conv_7,
         (SELECT count(*) FROM conversations WHERE workspace_id = $1 AND agent_id = $2 AND created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days') AS conv_prev,
         (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.workspace_id = $1 AND c.agent_id = $2 AND m.created_at >= now() - interval '7 days') AS msg_7,
         (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.workspace_id = $1 AND c.agent_id = $2 AND m.created_at >= now() - interval '14 days' AND m.created_at < now() - interval '7 days') AS msg_prev`,
      [workspaceId, agentId],
    ),
    withDb((db) =>
      db
        .select({
          id: conversations.id,
          title: conversations.title,
          status: conversations.status,
          channel: conversations.channel,
          messageCount: conversations.messageCount,
          lastMessageAt: conversations.lastMessageAt,
        })
        .from(conversations)
        .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.agentId, agentId)))
        // NULLS LAST is explicit: PostgreSQL defaults DESC to NULLS FIRST,
        // which would put threads that have never had a message first.
        .orderBy(sql`${conversations.lastMessageAt} DESC NULLS LAST`, desc(conversations.createdAt))
        .limit(5),
    ),
  ]);
  return {
    conversationsLast7Days: Number(counts?.conv_7 ?? 0),
    conversationsPrevious7Days: Number(counts?.conv_prev ?? 0),
    messagesLast7Days: Number(counts?.msg_7 ?? 0),
    messagesPrevious7Days: Number(counts?.msg_prev ?? 0),
    recentConversations: recent.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      channel: row.channel,
      messageCount: row.messageCount,
      lastMessageAt: toIso(row.lastMessageAt),
    })),
  };
}
