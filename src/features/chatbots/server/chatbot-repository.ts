import "server-only";

import { and, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { PoolClient } from "pg";

import { DEFAULT_APPEARANCE, DEFAULT_MODEL_CONFIG } from "@/features/chatbots/constants";
import type {
  Chatbot,
  ChatbotAppearance,
  ChatbotKnowledgeOption,
  ChatbotListFilters,
  ChatbotModelConfig,
  ChatbotOverview,
  ChatbotStatus,
  ChatbotSummary,
} from "@/features/chatbots/types";
import { query, queryOne, withDb } from "@/server/db/client";
import { chatbotCollections, chatbots, conversations, knowledgeCollections, knowledgeSources } from "@/server/db/schema";
import { normalizePage, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

/**
 * Chatbot persistence.
 *
 * This is the reference for the Drizzle migration (`docs/orm-evaluation.md`).
 * Two rules shape it:
 *
 * 1. Every tenant read and write still filters on `workspace_id` explicitly.
 *    Drizzle is a typing layer; a missing `where` is exactly as dangerous as
 *    it was in raw SQL, and Row Level Security remains the second line.
 * 2. When a query is genuinely SQL-shaped - date-window aggregates, ranking,
 *    `generate_series` - it stays raw. Forcing it through a builder would make
 *    it longer and no safer. Those queries keep using `query()`.
 *
 * The exported signatures are unchanged from the hand-written version, so no
 * service or route had to be touched.
 */

/** Columns every chatbot read returns, including the two derived counts. */
const chatbotSelection = {
  id: chatbots.id,
  workspaceId: chatbots.workspaceId,
  name: chatbots.name,
  slug: chatbots.slug,
  description: chatbots.description,
  status: chatbots.status,
  instructions: chatbots.instructions,
  welcomeMessage: chatbots.welcomeMessage,
  modelConfig: chatbots.modelConfig,
  appearance: chatbots.appearance,
  allowedDomains: chatbots.allowedDomains,
  embedKey: chatbots.embedKey,
  createdAt: chatbots.createdAt,
  updatedAt: chatbots.updatedAt,
  conversationCount: sql<number>`(SELECT count(*) FROM ${conversations} WHERE ${conversations.chatbotId} = ${chatbots.id})`.mapWith(
    Number,
  ),
  collectionIds: sql<
    string[] | null
  >`(SELECT array_agg(${chatbotCollections.collectionId}) FROM ${chatbotCollections} WHERE ${chatbotCollections.chatbotId} = ${chatbots.id})`,
};

function mapChatbot(row: {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  status: ChatbotStatus;
  instructions: string;
  welcomeMessage: string;
  modelConfig: unknown;
  appearance: unknown;
  allowedDomains: string[];
  embedKey: string;
  createdAt: Date;
  updatedAt: Date;
  conversationCount: number;
  collectionIds: string[] | null;
}): Chatbot {
  const collectionIds = row.collectionIds ?? [];
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    instructions: row.instructions,
    welcomeMessage: row.welcomeMessage,
    // jsonb is `unknown` by design: the database does not enforce its shape, so
    // the defaults below are what make a partially written blob safe to render.
    modelConfig: { ...DEFAULT_MODEL_CONFIG, ...((row.modelConfig ?? {}) as Partial<ChatbotModelConfig>) },
    appearance: { ...DEFAULT_APPEARANCE, ...((row.appearance ?? {}) as Partial<ChatbotAppearance>) },
    allowedDomains: row.allowedDomains ?? [],
    embedKey: row.embedKey,
    collectionIds,
    collectionCount: collectionIds.length,
    conversationCount: Number(row.conversationCount ?? 0),
    createdAt: toIsoRequired(row.createdAt),
    updatedAt: toIsoRequired(row.updatedAt),
  };
}

function toSummary(chatbot: Chatbot): ChatbotSummary {
  return {
    id: chatbot.id,
    name: chatbot.name,
    slug: chatbot.slug,
    description: chatbot.description,
    status: chatbot.status,
    conversationCount: chatbot.conversationCount,
    collectionCount: chatbot.collectionCount,
    createdAt: chatbot.createdAt,
    updatedAt: chatbot.updatedAt,
  };
}

export async function listChatbots(workspaceId: string, filters: ChatbotListFilters): Promise<Paginated<ChatbotSummary>> {
  const page = normalizePage(filters);

  // Built once and used by both the page query and the count, so the two can
  // never drift apart - which the old positional-parameter slicing allowed.
  const conditions: Array<SQL | undefined> = [
    eq(chatbots.workspaceId, workspaceId),
    filters.status ? eq(chatbots.status, filters.status) : ne(chatbots.status, "archived"),
  ];
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(or(ilike(chatbots.name, pattern), ilike(chatbots.description, pattern)));
  }
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    withDb((db) =>
      db.select(chatbotSelection).from(chatbots).where(where).orderBy(desc(chatbots.updatedAt)).limit(page.pageSize).offset(page.offset),
    ),
    withDb((db) => db.select({ total: count() }).from(chatbots).where(where)),
  ]);

  return toPaginated(rows.map(mapChatbot).map(toSummary), totals[0]?.total ?? 0, page);
}

export async function findChatbotById(workspaceId: string, chatbotId: string, client?: PoolClient): Promise<Chatbot | null> {
  const rows = await withDb(
    (db) =>
      db
        .select(chatbotSelection)
        .from(chatbots)
        .where(and(eq(chatbots.workspaceId, workspaceId), eq(chatbots.id, chatbotId)))
        .limit(1),
    client,
  );
  return rows[0] ? mapChatbot(rows[0]) : null;
}

/**
 * Public lookup used by the embeddable widget.
 *
 * Deliberately not workspace-scoped: the embed key IS the lookup key, and the
 * caller is responsible for enforcing the status and allowed-domain rules
 * before answering. See `src/app/api/public/chat/route.ts`.
 */
export async function findChatbotByEmbedKey(embedKey: string): Promise<Chatbot | null> {
  const rows = await withDb((db) => db.select(chatbotSelection).from(chatbots).where(eq(chatbots.embedKey, embedKey)).limit(1));
  return rows[0] ? mapChatbot(rows[0]) : null;
}

export async function slugExists(workspaceId: string, slug: string, client?: PoolClient): Promise<boolean> {
  const rows = await withDb(
    (db) =>
      db
        .select({ id: chatbots.id })
        .from(chatbots)
        .where(and(eq(chatbots.workspaceId, workspaceId), eq(chatbots.slug, slug)))
        .limit(1),
    client,
  );
  return rows.length > 0;
}

export interface InsertChatbotInput {
  workspaceId: string;
  createdBy: string;
  name: string;
  slug: string;
  description: string | null;
  embedKey: string;
  modelConfig: ChatbotModelConfig;
  appearance: ChatbotAppearance;
}

export async function insertChatbot(input: InsertChatbotInput, client?: PoolClient): Promise<Chatbot> {
  const inserted = await withDb(
    (db) =>
      db
        .insert(chatbots)
        .values({
          workspaceId: input.workspaceId,
          createdBy: input.createdBy,
          name: input.name,
          slug: input.slug,
          description: input.description,
          embedKey: input.embedKey,
          modelConfig: input.modelConfig,
          appearance: input.appearance,
        })
        .returning({ id: chatbots.id }),
    client,
  );
  const id = inserted[0]?.id;
  if (!id) throw new Error("Failed to insert chatbot");
  const chatbot = await findChatbotById(input.workspaceId, id, client);
  if (!chatbot) throw new Error("Chatbot vanished after insert");
  return chatbot;
}

export interface ChatbotPatch {
  name?: string;
  description?: string | null;
  instructions?: string;
  welcomeMessage?: string;
  status?: ChatbotStatus;
  modelConfig?: ChatbotModelConfig;
  appearance?: ChatbotAppearance;
  allowedDomains?: string[];
}

export async function updateChatbotRow(
  workspaceId: string,
  chatbotId: string,
  patch: ChatbotPatch,
  client?: PoolClient,
): Promise<void> {
  // Only the keys actually present are written, so an absent field is left
  // alone rather than being overwritten with undefined. `updated_at` is not
  // set here: the set_updated_at trigger owns it.
  const values: Partial<typeof chatbots.$inferInsert> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.instructions !== undefined) values.instructions = patch.instructions;
  if (patch.welcomeMessage !== undefined) values.welcomeMessage = patch.welcomeMessage;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.modelConfig !== undefined) values.modelConfig = patch.modelConfig;
  if (patch.appearance !== undefined) values.appearance = patch.appearance;
  if (patch.allowedDomains !== undefined) values.allowedDomains = patch.allowedDomains;

  if (Object.keys(values).length === 0) return;

  await withDb(
    (db) => db.update(chatbots).set(values).where(and(eq(chatbots.workspaceId, workspaceId), eq(chatbots.id, chatbotId))),
    client,
  );
}

export async function replaceChatbotKnowledgeBases(
  workspaceId: string,
  chatbotId: string,
  collectionIds: string[],
  client: PoolClient,
): Promise<void> {
  await withDb(
    (db) =>
      db
        .delete(chatbotCollections)
        .where(and(eq(chatbotCollections.workspaceId, workspaceId), eq(chatbotCollections.chatbotId, chatbotId))),
    client,
  );
  if (collectionIds.length === 0) return;
  await withDb(
    (db) =>
      db.insert(chatbotCollections).values(
        collectionIds.map((collectionId) => ({
          chatbotId,
          collectionId,
          workspaceId,
        })),
      ),
    client,
  );
}

export async function countWorkspaceKnowledgeBases(workspaceId: string, ids: string[], client?: PoolClient): Promise<number> {
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

export async function deleteChatbotRow(workspaceId: string, chatbotId: string): Promise<boolean> {
  const rows = await withDb((db) =>
    db
      .delete(chatbots)
      .where(and(eq(chatbots.workspaceId, workspaceId), eq(chatbots.id, chatbotId)))
      .returning({ id: chatbots.id }),
  );
  return rows.length > 0;
}

export async function listKnowledgeOptions(workspaceId: string, chatbotId: string): Promise<ChatbotKnowledgeOption[]> {
  const rows = await withDb((db) =>
    db
      .select({
        id: knowledgeCollections.id,
        name: knowledgeCollections.name,
        status: knowledgeCollections.status,
        sourceCount: sql<number>`(SELECT count(*) FROM ${knowledgeSources} WHERE ${knowledgeSources.collectionId} = ${knowledgeCollections.id})`.mapWith(
          Number,
        ),
        attached: sql<boolean>`EXISTS (SELECT 1 FROM ${chatbotCollections} WHERE ${chatbotCollections.collectionId} = ${knowledgeCollections.id} AND ${chatbotCollections.chatbotId} = ${chatbotId})`,
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
 * Left as raw SQL on purpose: four correlated date-window aggregates in one
 * round trip. A query builder would turn this into more code that produces the
 * same string, and the string is the part worth reading.
 */
export async function getChatbotOverview(workspaceId: string, chatbotId: string): Promise<ChatbotOverview> {
  const [counts, recent] = await Promise.all([
    queryOne<{ conv_7: string; conv_prev: string; msg_7: string; msg_prev: string }>(
      `SELECT
         (SELECT count(*) FROM conversations WHERE workspace_id = $1 AND chatbot_id = $2 AND created_at >= now() - interval '7 days') AS conv_7,
         (SELECT count(*) FROM conversations WHERE workspace_id = $1 AND chatbot_id = $2 AND created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days') AS conv_prev,
         (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.workspace_id = $1 AND c.chatbot_id = $2 AND m.created_at >= now() - interval '7 days') AS msg_7,
         (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.workspace_id = $1 AND c.chatbot_id = $2 AND m.created_at >= now() - interval '14 days' AND m.created_at < now() - interval '7 days') AS msg_prev`,
      [workspaceId, chatbotId],
    ),
    query<{ id: string; title: string | null; status: string; channel: string; message_count: number; last_message_at: Date | null }>(
      `SELECT id, title, status, channel, message_count, last_message_at
       FROM conversations WHERE workspace_id = $1 AND chatbot_id = $2
       ORDER BY last_message_at DESC NULLS LAST, created_at DESC LIMIT 5`,
      [workspaceId, chatbotId],
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
