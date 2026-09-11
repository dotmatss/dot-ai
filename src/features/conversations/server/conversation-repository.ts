import "server-only";

import type {
  ContactSearchResult,
  Conversation,
  ConversationAiSummary,
  ConversationListFilters,
  ConversationListItem,
  ConversationMessage,
  ConversationStatus,
  MessageRole,
} from "@/features/conversations/types";
import { query, queryOne, type Queryable } from "@/server/db/client";
import { likePattern, normalizePage, ParamBuilder, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { RetrievedSource, TokenUsage } from "@/types/ai";
import type { Paginated } from "@/types/pagination";

export type ConversationChannel = "widget" | "playground" | "api" | "agent";

export interface ConversationRecord {
  id: string;
  workspaceId: string;
  chatbotId: string | null;
  agentId: string | null;
  contactId: string | null;
  channel: ConversationChannel;
  status: "open" | "resolved" | "escalated";
  title: string | null;
  messageCount: number;
}

interface ConversationRow {
  id: string;
  workspace_id: string;
  chatbot_id: string | null;
  agent_id: string | null;
  contact_id: string | null;
  channel: ConversationChannel;
  status: "open" | "resolved" | "escalated";
  title: string | null;
  message_count: number;
}

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    chatbotId: row.chatbot_id,
    agentId: row.agent_id,
    contactId: row.contact_id,
    channel: row.channel,
    status: row.status,
    title: row.title,
    messageCount: row.message_count,
  };
}

const CONVERSATION_COLUMNS = "id, workspace_id, chatbot_id, agent_id, contact_id, channel, status, title, message_count";

export async function createConversation(
  input: {
    workspaceId: string;
    chatbotId?: string | null;
    agentId?: string | null;
    contactId?: string | null;
    channel: ConversationChannel;
    title?: string | null;
    metadata?: Record<string, unknown>;
  },
  client?: Queryable,
): Promise<ConversationRecord> {
  const row = await queryOne<ConversationRow>(
    `INSERT INTO conversations (workspace_id, chatbot_id, agent_id, contact_id, channel, title, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${CONVERSATION_COLUMNS}`,
    [
      input.workspaceId,
      input.chatbotId ?? null,
      input.agentId ?? null,
      input.contactId ?? null,
      input.channel,
      input.title ?? null,
      input.metadata ?? {},
    ],
    client,
  );
  if (!row) throw new Error("Failed to create conversation");
  return mapConversation(row);
}

export async function findConversation(workspaceId: string, conversationId: string, client?: Queryable): Promise<ConversationRecord | null> {
  const row = await queryOne<ConversationRow>(
    `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, conversationId],
    client,
  );
  return row ? mapConversation(row) : null;
}

export async function appendMessage(
  input: {
    workspaceId: string;
    conversationId: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    sources?: RetrievedSource[] | null;
    usage?: TokenUsage | null;
    toolCalls?: unknown[] | null;
    /**
     * Set when a team member wrote the message from the inbox. Human replies
     * keep role = 'assistant' so model context stays coherent; the author is
     * what makes the UI render them as "Team".
     */
    authorId?: string | null;
  },
  client?: Queryable,
): Promise<{ id: string; createdAt: Date }> {
  const row = await queryOne<{ id: string; created_at: Date }>(
    `INSERT INTO messages (workspace_id, conversation_id, role, content, sources, usage, tool_calls, author_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at`,
    [
      input.workspaceId,
      input.conversationId,
      input.role,
      input.content,
      input.sources ? JSON.stringify(input.sources) : null,
      input.usage ? JSON.stringify(input.usage) : null,
      input.toolCalls ? JSON.stringify(input.toolCalls) : null,
      input.authorId ?? null,
    ],
    client,
  );
  if (!row) throw new Error("Failed to append message");
  await query(
    `UPDATE conversations SET message_count = message_count + 1, last_message_at = $3
     WHERE workspace_id = $1 AND id = $2`,
    [input.workspaceId, input.conversationId, row.created_at],
    client,
  );
  return { id: row.id, createdAt: row.created_at };
}

export function deriveConversationTitle(firstMessage: string): string {
  const trimmed = firstMessage.replace(/\s+/g, " ").trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}

// ---------------------------------------------------------------------------
// Inbox queries
// ---------------------------------------------------------------------------

interface ConversationItemRow {
  id: string;
  workspace_id: string;
  title: string | null;
  status: ConversationStatus;
  channel: ConversationChannel;
  message_count: number;
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
  chatbot_id: string | null;
  chatbot_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_avatar_url: string | null;
}

interface ConversationDetailRow extends ConversationItemRow {
  metadata: unknown;
}

const ITEM_COLUMNS = `
  c.id, c.workspace_id, c.title, c.status, c.channel, c.message_count, c.last_message_at, c.created_at, c.updated_at,
  cb.id AS chatbot_id, cb.name AS chatbot_name,
  ag.id AS agent_id, ag.name AS agent_name,
  ct.id AS contact_id, ct.name AS contact_name, ct.email AS contact_email,
  au.id AS assignee_id, au.name AS assignee_name, au.avatar_url AS assignee_avatar_url`;

/**
 * The originating chatbot/agent, the linked contact and the assignee are all
 * optional, so every join is a LEFT JOIN, and each join onto a tenant table is
 * additionally constrained to the same workspace: a stale id must never be able
 * to surface a row from another tenant.
 */
const CONVERSATION_FROM = `
  FROM conversations c
  LEFT JOIN chatbots cb ON cb.id = c.chatbot_id AND cb.workspace_id = c.workspace_id
  LEFT JOIN agents ag ON ag.id = c.agent_id AND ag.workspace_id = c.workspace_id
  LEFT JOIN contacts ct ON ct.id = c.contact_id AND ct.workspace_id = c.workspace_id
  LEFT JOIN users au ON au.id = c.assigned_to`;

function mapListItem(row: ConversationItemRow): ConversationListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    channel: row.channel,
    messageCount: row.message_count,
    lastMessageAt: toIso(row.last_message_at),
    createdAt: toIsoRequired(row.created_at),
    updatedAt: toIsoRequired(row.updated_at),
    source:
      row.chatbot_id && row.chatbot_name !== null
        ? { type: "chatbot", id: row.chatbot_id, name: row.chatbot_name }
        : row.agent_id && row.agent_name !== null
          ? { type: "agent", id: row.agent_id, name: row.agent_name }
          : null,
    contact: row.contact_id ? { id: row.contact_id, name: row.contact_name, email: row.contact_email } : null,
    assignee:
      row.assignee_id && row.assignee_name !== null
        ? { id: row.assignee_id, name: row.assignee_name, avatarUrl: row.assignee_avatar_url }
        : null,
  };
}

/**
 * `metadata` is a free-form jsonb column written by several pipelines, so the
 * summary is validated on read instead of being trusted to match the type.
 */
function readSummary(metadata: unknown): ConversationAiSummary | null {
  if (!metadata || typeof metadata !== "object") return null;
  const candidate = (metadata as Record<string, unknown>).summary;
  if (!candidate || typeof candidate !== "object") return null;
  const summary = candidate as Record<string, unknown>;
  if (typeof summary.text !== "string" || typeof summary.generatedAt !== "string") return null;
  return {
    text: summary.text,
    generatedAt: summary.generatedAt,
    generatedBy: typeof summary.generatedBy === "string" ? summary.generatedBy : null,
    messageCount: typeof summary.messageCount === "number" ? summary.messageCount : 0,
  };
}

function mapConversationDetail(row: ConversationDetailRow): Conversation {
  return { ...mapListItem(row), workspaceId: row.workspace_id, summary: readSummary(row.metadata) };
}

/**
 * Inbox list. `assignedTo` must already be resolved to a user id by the caller;
 * the "me" literal is a URL convenience, never a database value.
 */
export async function listConversations(workspaceId: string, filters: ConversationListFilters): Promise<Paginated<ConversationListItem>> {
  const page = normalizePage(filters);
  const params = new ParamBuilder();
  const where: string[] = [`c.workspace_id = ${params.add(workspaceId)}`];
  if (filters.status) where.push(`c.status = ${params.add(filters.status)}`);
  if (filters.channel) where.push(`c.channel = ${params.add(filters.channel)}`);
  if (filters.chatbotId) where.push(`c.chatbot_id = ${params.add(filters.chatbotId)}`);
  if (filters.agentId) where.push(`c.agent_id = ${params.add(filters.agentId)}`);
  if (filters.contactId) where.push(`c.contact_id = ${params.add(filters.contactId)}`);
  if (filters.assignedTo) where.push(`c.assigned_to = ${params.add(filters.assignedTo)}`);
  if (filters.q) {
    // EXISTS rather than a join onto messages: several matching messages must
    // not multiply the conversation row and corrupt the count and page size.
    const pattern = params.add(likePattern(filters.q));
    where.push(
      `(c.title ILIKE ${pattern} OR EXISTS (
         SELECT 1 FROM messages m
         WHERE m.conversation_id = c.id AND m.workspace_id = c.workspace_id AND m.content ILIKE ${pattern}))`,
    );
  }
  const whereSql = where.join(" AND ");

  const [rows, countRow] = await Promise.all([
    query<ConversationItemRow>(
      `SELECT ${ITEM_COLUMNS} ${CONVERSATION_FROM}
       WHERE ${whereSql}
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
       LIMIT ${params.add(page.pageSize)} OFFSET ${params.add(page.offset)}`,
      params.values,
    ),
    queryOne<{ count: string }>(`SELECT count(*) AS count FROM conversations c WHERE ${whereSql}`, params.values.slice(0, -2)),
  ]);

  return toPaginated(rows.map(mapListItem), Number(countRow?.count ?? 0), page);
}

/** Full conversation with its joined labels and the stored AI summary. */
export async function findConversationDetail(
  workspaceId: string,
  conversationId: string,
  client?: Queryable,
): Promise<Conversation | null> {
  const row = await queryOne<ConversationDetailRow>(
    `SELECT ${ITEM_COLUMNS}, c.metadata ${CONVERSATION_FROM} WHERE c.workspace_id = $1 AND c.id = $2`,
    [workspaceId, conversationId],
    client,
  );
  return row ? mapConversationDetail(row) : null;
}

interface MessageRow {
  id: string;
  role: MessageRole;
  content: string;
  sources: unknown;
  tool_calls: unknown;
  usage: unknown;
  author_id: string | null;
  author_name: string | null;
  created_at: Date;
}

function readSources(value: unknown): RetrievedSource[] | null {
  if (!Array.isArray(value)) return null;
  const sources = value.filter(
    (item): item is RetrievedSource => Boolean(item) && typeof item === "object" && typeof (item as RetrievedSource).title === "string",
  );
  return sources.length > 0 ? sources : null;
}

function readUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const usage = value as Record<string, unknown>;
  if (typeof usage.inputTokens !== "number" || typeof usage.outputTokens !== "number") return null;
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
}

function mapMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    sources: readSources(row.sources),
    toolCalls: Array.isArray(row.tool_calls) && row.tool_calls.length > 0 ? row.tool_calls : null,
    usage: readUsage(row.usage),
    author: row.author_id && row.author_name !== null ? { id: row.author_id, name: row.author_name } : null,
    createdAt: toIsoRequired(row.created_at),
  };
}

/**
 * The most recent `limit` messages, returned oldest-first. Ordering descending
 * and reversing keeps the newest turns when a long thread is capped, while the
 * caller still renders chronologically.
 */
export async function listConversationMessages(
  workspaceId: string,
  conversationId: string,
  limit: number,
  client?: Queryable,
): Promise<ConversationMessage[]> {
  const rows = await query<MessageRow>(
    `SELECT m.id, m.role, m.content, m.sources, m.tool_calls, m.usage, m.author_id, u.name AS author_name, m.created_at
     FROM messages m
     LEFT JOIN users u ON u.id = m.author_id
     WHERE m.workspace_id = $1 AND m.conversation_id = $2
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT $3`,
    [workspaceId, conversationId, limit],
    client,
  );
  return rows.reverse().map(mapMessage);
}

export interface ConversationPatch {
  status?: ConversationStatus;
  assignedTo?: string | null;
  contactId?: string | null;
}

const COLUMN_BY_FIELD: Record<keyof ConversationPatch, string> = {
  status: "status",
  assignedTo: "assigned_to",
  contactId: "contact_id",
};

export async function updateConversationRow(
  workspaceId: string,
  conversationId: string,
  patch: ConversationPatch,
  client?: Queryable,
): Promise<void> {
  const params = new ParamBuilder();
  const sets: string[] = [];
  for (const [field, value] of Object.entries(patch) as Array<[keyof ConversationPatch, unknown]>) {
    if (value === undefined) continue;
    sets.push(`${COLUMN_BY_FIELD[field]} = ${params.add(value)}`);
  }
  if (sets.length === 0) return;
  await query(
    `UPDATE conversations SET ${sets.join(", ")} WHERE workspace_id = ${params.add(workspaceId)} AND id = ${params.add(conversationId)}`,
    params.values,
    client,
  );
}

/** Merges the AI recap into `metadata` so unrelated keys written elsewhere survive. */
export async function saveConversationSummary(
  workspaceId: string,
  conversationId: string,
  summary: ConversationAiSummary,
  client?: Queryable,
): Promise<void> {
  await query(
    `UPDATE conversations
     SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('summary', $3::jsonb)
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, conversationId, JSON.stringify(summary)],
    client,
  );
}

export async function contactExists(workspaceId: string, contactId: string, client?: Queryable): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    "SELECT id FROM contacts WHERE workspace_id = $1 AND id = $2",
    [workspaceId, contactId],
    client,
  );
  return Boolean(row);
}

/**
 * Assignment targets are checked against the workspace's organization: a user
 * id taken from a request body is otherwise an unauthenticated pointer at any
 * row in `users`.
 */
export async function isWorkspaceMember(workspaceId: string, userId: string, client?: Queryable): Promise<boolean> {
  const row = await queryOne<{ user_id: string }>(
    `SELECT m.user_id FROM workspaces w
     JOIN organization_members m ON m.organization_id = w.organization_id
     WHERE w.id = $1 AND m.user_id = $2`,
    [workspaceId, userId],
    client,
  );
  return Boolean(row);
}

/**
 * Type-ahead over the workspace's contacts. It lives here because the inbox
 * needs contact linking before the CRM feature ships its own endpoint.
 */
export async function searchContacts(workspaceId: string, term: string, limit: number): Promise<ContactSearchResult[]> {
  const pattern = likePattern(term);
  const rows = await query<{ id: string; name: string | null; email: string | null; company: string | null; stage: string }>(
    `SELECT id, name, email, company, stage
     FROM contacts
     WHERE workspace_id = $1 AND (name ILIKE $2 OR email ILIKE $2 OR company ILIKE $2)
     ORDER BY name ASC NULLS LAST, email ASC NULLS LAST
     LIMIT $3`,
    [workspaceId, pattern, limit],
  );
  return rows.map((row) => ({ id: row.id, name: row.name, email: row.email, company: row.company, stage: row.stage }));
}
