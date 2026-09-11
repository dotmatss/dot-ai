import "server-only";

import { DEFAULT_MEMORY_CONFIG, DEFAULT_MODEL_CONFIG } from "@/features/agents/constants";
import { normalizeToolSettings } from "@/features/agents/tools/registry";
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
} from "@/features/agents/types";
import { query, queryOne, type Queryable } from "@/server/db/client";
import { likePattern, normalizePage, ParamBuilder, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

interface AgentRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  instructions: string;
  model_config: Partial<AgentModelConfig> | null;
  tools: unknown;
  memory_config: Partial<AgentMemoryConfig> | null;
  output_schema: AgentOutputSchema | null;
  requires_approval: boolean;
  created_at: Date;
  updated_at: Date;
  conversation_count: string | number;
  knowledge_base_ids: string[] | null;
}

const SELECT_AGENT = `
  SELECT ag.id, ag.workspace_id, ag.name, ag.description, ag.status, ag.instructions, ag.model_config, ag.tools,
         ag.memory_config, ag.output_schema, ag.requires_approval, ag.created_at, ag.updated_at,
         (SELECT count(*) FROM conversations c WHERE c.agent_id = ag.id) AS conversation_count,
         (SELECT array_agg(akb.knowledge_base_id) FROM agent_knowledge_bases akb WHERE akb.agent_id = ag.id) AS knowledge_base_ids
  FROM agents ag
`;

function mapAgent(row: AgentRow): Agent {
  const knowledgeBaseIds = row.knowledge_base_ids ?? [];
  const tools = normalizeToolSettings(row.tools);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    status: row.status,
    instructions: row.instructions,
    modelConfig: { ...DEFAULT_MODEL_CONFIG, ...(row.model_config ?? {}) },
    tools,
    memoryConfig: { ...DEFAULT_MEMORY_CONFIG, ...(row.memory_config ?? {}) },
    outputSchema: row.output_schema,
    requiresApproval: row.requires_approval,
    knowledgeBaseIds,
    knowledgeBaseCount: knowledgeBaseIds.length,
    enabledToolCount: tools.filter((tool) => tool.enabled).length,
    conversationCount: Number(row.conversation_count ?? 0),
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
  };
}

function toSummary(agent: Agent): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    status: agent.status,
    conversationCount: agent.conversationCount,
    knowledgeBaseCount: agent.knowledgeBaseCount,
    enabledToolCount: agent.enabledToolCount,
    requiresApproval: agent.requiresApproval,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

export async function listAgents(workspaceId: string, filters: AgentListFilters): Promise<Paginated<AgentSummary>> {
  const page = normalizePage(filters);
  const params = new ParamBuilder();
  const where: string[] = [`ag.workspace_id = ${params.add(workspaceId)}`];
  if (filters.status) {
    where.push(`ag.status = ${params.add(filters.status)}`);
  } else {
    where.push(`ag.status <> 'archived'`);
  }
  if (filters.q) {
    const pattern = params.add(likePattern(filters.q));
    where.push(`(ag.name ILIKE ${pattern} OR ag.description ILIKE ${pattern})`);
  }
  const whereSql = where.join(" AND ");

  const [rows, countRow] = await Promise.all([
    query<AgentRow>(
      `${SELECT_AGENT} WHERE ${whereSql} ORDER BY ag.updated_at DESC LIMIT ${params.add(page.pageSize)} OFFSET ${params.add(page.offset)}`,
      params.values,
    ),
    // The last two parameters are LIMIT/OFFSET, which the count query does not use.
    queryOne<{ count: string }>(`SELECT count(*) AS count FROM agents ag WHERE ${whereSql}`, params.values.slice(0, -2)),
  ]);

  return toPaginated(rows.map(mapAgent).map(toSummary), Number(countRow?.count ?? 0), page);
}

export async function findAgentById(workspaceId: string, agentId: string, client?: Queryable): Promise<Agent | null> {
  const row = await queryOne<AgentRow>(`${SELECT_AGENT} WHERE ag.workspace_id = $1 AND ag.id = $2`, [workspaceId, agentId], client);
  return row ? mapAgent(row) : null;
}

export interface InsertAgentInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  description: string | null;
  modelConfig: AgentModelConfig;
  memoryConfig: AgentMemoryConfig;
}

export async function insertAgent(input: InsertAgentInput, client?: Queryable): Promise<Agent> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO agents (workspace_id, created_by, name, description, model_config, memory_config)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.workspaceId, input.createdBy, input.name, input.description, input.modelConfig, input.memoryConfig],
    client,
  );
  if (!row) throw new Error("Failed to insert agent");
  const agent = await findAgentById(input.workspaceId, row.id, client);
  if (!agent) throw new Error("Agent vanished after insert");
  return agent;
}

export interface AgentPatch {
  name?: string;
  description?: string | null;
  instructions?: string;
  status?: AgentStatus;
  modelConfig?: AgentModelConfig;
  tools?: AgentToolSetting[];
  memoryConfig?: AgentMemoryConfig;
  outputSchema?: AgentOutputSchema | null;
  requiresApproval?: boolean;
}

const COLUMN_BY_FIELD: Record<keyof AgentPatch, string> = {
  name: "name",
  description: "description",
  instructions: "instructions",
  status: "status",
  modelConfig: "model_config",
  tools: "tools",
  memoryConfig: "memory_config",
  outputSchema: "output_schema",
  requiresApproval: "requires_approval",
};

/**
 * The pg driver encodes JavaScript arrays as PostgreSQL array literals, which
 * jsonb rejects, so jsonb arrays are handed over as JSON text.
 */
function toParam(field: keyof AgentPatch, value: unknown): unknown {
  return field === "tools" ? JSON.stringify(value) : value;
}

export async function updateAgentRow(workspaceId: string, agentId: string, patch: AgentPatch, client?: Queryable): Promise<void> {
  const params = new ParamBuilder();
  const sets: string[] = [];
  for (const [field, value] of Object.entries(patch) as Array<[keyof AgentPatch, unknown]>) {
    if (value === undefined) continue;
    sets.push(`${COLUMN_BY_FIELD[field]} = ${params.add(toParam(field, value))}`);
  }
  if (sets.length === 0) return;
  await query(
    `UPDATE agents SET ${sets.join(", ")} WHERE workspace_id = ${params.add(workspaceId)} AND id = ${params.add(agentId)}`,
    params.values,
    client,
  );
}

export async function replaceAgentKnowledgeBases(
  workspaceId: string,
  agentId: string,
  knowledgeBaseIds: string[],
  client: Queryable,
): Promise<void> {
  await query("DELETE FROM agent_knowledge_bases WHERE workspace_id = $1 AND agent_id = $2", [workspaceId, agentId], client);
  if (knowledgeBaseIds.length === 0) return;
  const params = new ParamBuilder();
  const rows = knowledgeBaseIds.map((id) => `(${params.add(agentId)}, ${params.add(id)}, ${params.add(workspaceId)})`);
  await query(`INSERT INTO agent_knowledge_bases (agent_id, knowledge_base_id, workspace_id) VALUES ${rows.join(", ")}`, params.values, client);
}

/** Tenancy guard: knowledge bases may only be attached from the caller's workspace. */
export async function countWorkspaceKnowledgeBases(workspaceId: string, ids: string[], client?: Queryable): Promise<number> {
  if (ids.length === 0) return 0;
  const row = await queryOne<{ count: string }>(
    "SELECT count(*) AS count FROM knowledge_bases WHERE workspace_id = $1 AND id = ANY($2::uuid[])",
    [workspaceId, ids],
    client,
  );
  return Number(row?.count ?? 0);
}

export async function deleteAgentRow(workspaceId: string, agentId: string): Promise<boolean> {
  const rows = await query<{ id: string }>("DELETE FROM agents WHERE workspace_id = $1 AND id = $2 RETURNING id", [workspaceId, agentId]);
  return rows.length > 0;
}

export async function listKnowledgeOptions(workspaceId: string, agentId: string): Promise<AgentKnowledgeOption[]> {
  const rows = await query<{ id: string; name: string; status: string; source_count: string; attached: boolean }>(
    `SELECT kb.id, kb.name, kb.status,
            (SELECT count(*) FROM knowledge_sources ks WHERE ks.knowledge_base_id = kb.id) AS source_count,
            EXISTS (SELECT 1 FROM agent_knowledge_bases akb WHERE akb.knowledge_base_id = kb.id AND akb.agent_id = $2) AS attached
     FROM knowledge_bases kb
     WHERE kb.workspace_id = $1
     ORDER BY kb.name`,
    [workspaceId, agentId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    sourceCount: Number(row.source_count),
    attached: row.attached,
  }));
}

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
    query<{ id: string; title: string | null; status: string; channel: string; message_count: number; last_message_at: Date | null }>(
      `SELECT id, title, status, channel, message_count, last_message_at
       FROM conversations WHERE workspace_id = $1 AND agent_id = $2
       ORDER BY last_message_at DESC NULLS LAST, created_at DESC LIMIT 5`,
      [workspaceId, agentId],
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
      messageCount: row.message_count,
      lastMessageAt: toIso(row.last_message_at),
    })),
  };
}
