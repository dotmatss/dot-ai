import "server-only";

import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

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
import { withDb, type Database, type DatabaseClient } from "@/server/db/client";
import { agents, chatbots, contacts, conversations, messages, organizationMembers, users, workspaces } from "@/server/db/schema";
import { likePattern, normalizePage, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
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

const conversationColumns = {
  id: conversations.id,
  workspaceId: conversations.workspaceId,
  chatbotId: conversations.chatbotId,
  agentId: conversations.agentId,
  contactId: conversations.contactId,
  channel: conversations.channel,
  status: conversations.status,
  title: conversations.title,
  messageCount: conversations.messageCount,
};

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
  client?: DatabaseClient,
): Promise<ConversationRecord> {
  const rows = await withDb(
    (db) =>
      db
        .insert(conversations)
        .values({
          workspaceId: input.workspaceId,
          chatbotId: input.chatbotId ?? null,
          agentId: input.agentId ?? null,
          contactId: input.contactId ?? null,
          channel: input.channel,
          title: input.title ?? null,
          metadata: input.metadata ?? {},
        })
        .returning(conversationColumns),
    client,
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create conversation");
  return row;
}

export async function findConversation(
  workspaceId: string,
  conversationId: string,
  client?: DatabaseClient,
): Promise<ConversationRecord | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(conversationColumns)
        .from(conversations)
        .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.id, conversationId)))
        .limit(1),
    client,
  );
  return rows[0] ?? null;
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
  client?: DatabaseClient,
): Promise<{ id: string; createdAt: Date }> {
  const inserted = await withDb(
    (db) =>
      db
        .insert(messages)
        .values({
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          sources: input.sources ?? null,
          usage: input.usage ?? null,
          toolCalls: input.toolCalls ?? null,
          authorId: input.authorId ?? null,
        })
        .returning({ id: messages.id, createdAt: messages.createdAt }),
    client,
  );
  const row = inserted[0];
  if (!row) throw new Error("Failed to append message");

  // Incremented in the database rather than read-modify-written here, so two
  // concurrent appends cannot both write the same count.
  await withDb(
    (db) =>
      db
        .update(conversations)
        .set({ messageCount: sql`${conversations.messageCount} + 1`, lastMessageAt: row.createdAt })
        .where(and(eq(conversations.workspaceId, input.workspaceId), eq(conversations.id, input.conversationId))),
    client,
  );
  return { id: row.id, createdAt: row.createdAt };
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
  workspaceId: string;
  title: string | null;
  status: ConversationStatus;
  channel: ConversationChannel;
  messageCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  chatbotId: string | null;
  chatbotName: string | null;
  agentId: string | null;
  agentName: string | null;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeAvatarUrl: string | null;
}

interface ConversationDetailRow extends ConversationItemRow {
  metadata: unknown;
}

/**
 * The joined labels. Each id comes from the JOINED row, not from the foreign
 * key column, so a label and its id can never disagree.
 */
const itemColumns = {
  id: conversations.id,
  workspaceId: conversations.workspaceId,
  title: conversations.title,
  status: conversations.status,
  channel: conversations.channel,
  messageCount: conversations.messageCount,
  lastMessageAt: conversations.lastMessageAt,
  createdAt: conversations.createdAt,
  updatedAt: conversations.updatedAt,
  chatbotId: chatbots.id,
  chatbotName: chatbots.name,
  agentId: agents.id,
  agentName: agents.name,
  contactId: contacts.id,
  contactName: contacts.name,
  contactEmail: contacts.email,
  assigneeId: users.id,
  assigneeName: users.name,
  assigneeAvatarUrl: users.avatarUrl,
};

/**
 * The originating chatbot/agent, the linked contact and the assignee are all
 * optional, so every join is a LEFT JOIN, and each join onto a tenant table is
 * additionally constrained to the same workspace: a stale id must never be able
 * to surface a row from another tenant.
 *
 * `users` carries no workspace of its own - the assignee is validated by
 * `isWorkspaceMember()` before it is ever written.
 */
function conversationsWithLabels(
  db: Database,
  selection: typeof itemColumns | (typeof itemColumns & { metadata: typeof conversations.metadata }),
) {
  return db
    .select(selection)
    .from(conversations)
    .leftJoin(chatbots, and(eq(chatbots.id, conversations.chatbotId), eq(chatbots.workspaceId, conversations.workspaceId)))
    .leftJoin(agents, and(eq(agents.id, conversations.agentId), eq(agents.workspaceId, conversations.workspaceId)))
    .leftJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.workspaceId, conversations.workspaceId)))
    .leftJoin(users, eq(users.id, conversations.assignedTo));
}

function mapListItem(row: ConversationItemRow): ConversationListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    channel: row.channel,
    messageCount: row.messageCount,
    lastMessageAt: toIso(row.lastMessageAt),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
    source:
      row.chatbotId && row.chatbotName !== null
        ? { type: "chatbot", id: row.chatbotId, name: row.chatbotName }
        : row.agentId && row.agentName !== null
          ? { type: "agent", id: row.agentId, name: row.agentName }
          : null,
    contact: row.contactId ? { id: row.contactId, name: row.contactName, email: row.contactEmail } : null,
    assignee:
      row.assigneeId && row.assigneeName !== null
        ? { id: row.assigneeId, name: row.assigneeName, avatarUrl: row.assigneeAvatarUrl }
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
  return { ...mapListItem(row), workspaceId: row.workspaceId, summary: readSummary(row.metadata) };
}

/**
 * Inbox list. `assignedTo` must already be resolved to a user id by the caller;
 * the "me" literal is a URL convenience, never a database value.
 */
export async function listConversations(
  workspaceId: string,
  filters: ConversationListFilters,
): Promise<Paginated<ConversationListItem>> {
  const page = normalizePage(filters);

  const conditions: Array<SQL | undefined> = [eq(conversations.workspaceId, workspaceId)];
  if (filters.status) conditions.push(eq(conversations.status, filters.status));
  if (filters.channel) conditions.push(eq(conversations.channel, filters.channel));
  if (filters.chatbotId) conditions.push(eq(conversations.chatbotId, filters.chatbotId));
  if (filters.agentId) conditions.push(eq(conversations.agentId, filters.agentId));
  if (filters.contactId) conditions.push(eq(conversations.contactId, filters.contactId));
  if (filters.assignedTo) conditions.push(eq(conversations.assignedTo, filters.assignedTo));
  if (filters.q) {
    // EXISTS rather than a join onto messages: several matching messages must
    // not multiply the conversation row and corrupt the count and page size.
    const pattern = likePattern(filters.q);
    conditions.push(
      or(
        ilike(conversations.title, pattern),
        sql`EXISTS (
          SELECT 1 FROM ${messages}
          WHERE ${messages.conversationId} = ${conversations.id}
            AND ${messages.workspaceId} = ${conversations.workspaceId}
            AND ${messages.content} ILIKE ${pattern})`,
      ),
    );
  }
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      conversationsWithLabels(db, itemColumns)
        .where(where)
        // NULLS LAST is explicit: PostgreSQL defaults DESC to NULLS FIRST,
        // which would float conversations that have never had a message to
        // the top of the inbox.
        .orderBy(sql`${conversations.lastMessageAt} DESC NULLS LAST`, desc(conversations.createdAt))
        .limit(page.pageSize)
        .offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(conversations).where(where)),
  ]);

  return toPaginated(rows.map(mapListItem), totals[0]?.total ?? 0, page);
}

/** Full conversation with its joined labels and the stored AI summary. */
export async function findConversationDetail(
  workspaceId: string,
  conversationId: string,
  client?: DatabaseClient,
): Promise<Conversation | null> {
  const rows = await withDb(
    (db) =>
      conversationsWithLabels(db, { ...itemColumns, metadata: conversations.metadata })
        .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.id, conversationId)))
        .limit(1),
    client,
  );
  return rows[0] ? mapConversationDetail(rows[0] as ConversationDetailRow) : null;
}

interface MessageRow {
  id: string;
  role: MessageRole;
  content: string;
  sources: unknown;
  toolCalls: unknown;
  usage: unknown;
  authorId: string | null;
  authorName: string | null;
  createdAt: Date;
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
    toolCalls: Array.isArray(row.toolCalls) && row.toolCalls.length > 0 ? row.toolCalls : null,
    usage: readUsage(row.usage),
    author: row.authorId && row.authorName !== null ? { id: row.authorId, name: row.authorName } : null,
    createdAt: toIsoRequired(row.createdAt),
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
  client?: DatabaseClient,
): Promise<ConversationMessage[]> {
  const rows = await withDb(
    (db) =>
      db
        .select({
          id: messages.id,
          role: messages.role,
          content: messages.content,
          sources: messages.sources,
          toolCalls: messages.toolCalls,
          usage: messages.usage,
          authorId: messages.authorId,
          authorName: users.name,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.authorId))
        .where(and(eq(messages.workspaceId, workspaceId), eq(messages.conversationId, conversationId)))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit),
    client,
  );
  return rows.reverse().map(mapMessage);
}

export interface ConversationPatch {
  status?: ConversationStatus;
  assignedTo?: string | null;
  contactId?: string | null;
}

export async function updateConversationRow(
  workspaceId: string,
  conversationId: string,
  patch: ConversationPatch,
  client?: DatabaseClient,
): Promise<void> {
  // Only the keys actually present are written; an absent field is left alone
  // rather than being overwritten with undefined.
  const values: Partial<typeof conversations.$inferInsert> = {};
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.assignedTo !== undefined) values.assignedTo = patch.assignedTo;
  if (patch.contactId !== undefined) values.contactId = patch.contactId;
  if (Object.keys(values).length === 0) return;

  await withDb(
    (db) =>
      db
        .update(conversations)
        .set(values)
        .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.id, conversationId))),
    client,
  );
}

/** Merges the AI recap into `metadata` so unrelated keys written elsewhere survive. */
export async function saveConversationSummary(
  workspaceId: string,
  conversationId: string,
  summary: ConversationAiSummary,
  client?: DatabaseClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .update(conversations)
        // `||` is the jsonb concatenation operator: it merges the new key into
        // whatever else the column holds, which an assignment would discard.
        .set({
          metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('summary', ${JSON.stringify(summary)}::jsonb)`,
        })
        .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.id, conversationId))),
    client,
  );
}

export async function contactExists(workspaceId: string, contactId: string, client?: DatabaseClient): Promise<boolean> {
  const rows = await withDb(
    (db) =>
      db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, contactId)))
        .limit(1),
    client,
  );
  return rows.length > 0;
}

/**
 * Assignment targets are checked against the workspace's organization: a user
 * id taken from a request body is otherwise an unauthenticated pointer at any
 * row in `users`.
 */
export async function isWorkspaceMember(workspaceId: string, userId: string, client?: DatabaseClient): Promise<boolean> {
  const rows = await withDb(
    (db) =>
      db
        .select({ userId: organizationMembers.userId })
        .from(workspaces)
        .innerJoin(organizationMembers, eq(organizationMembers.organizationId, workspaces.organizationId))
        .where(and(eq(workspaces.id, workspaceId), eq(organizationMembers.userId, userId)))
        .limit(1),
    client,
  );
  return rows.length > 0;
}

/**
 * Type-ahead over the workspace's contacts. It lives here because the inbox
 * needs contact linking before the CRM feature ships its own endpoint.
 */
export async function searchContacts(workspaceId: string, term: string, limit: number): Promise<ContactSearchResult[]> {
  const pattern = likePattern(term);
  const rows = await withDb((db) =>
    db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        company: contacts.company,
        stage: contacts.stage,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          or(ilike(contacts.name, pattern), ilike(contacts.email, pattern), ilike(contacts.company, pattern)),
        ),
      )
      // ASC already sorts nulls last in PostgreSQL, which is what the unnamed
      // contacts here rely on.
      .orderBy(asc(contacts.name), asc(contacts.email))
      .limit(limit),
  );
  return rows.map((row) => ({ id: row.id, name: row.name, email: row.email, company: row.company, stage: row.stage }));
}
