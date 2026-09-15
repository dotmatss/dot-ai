import "server-only";

import { and, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
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
import { queryOne, withDb } from "@/server/db/client";
import { agents, chatbotCollections, chatbots, conversations, knowledgeCollections, knowledgeSources } from "@/server/db/schema";
import { normalizePage, toIso, toIsoRequired, toPaginated } from "@/server/db/sql";
import type { Paginated } from "@/types/pagination";

/** Connection-less builder, used only to COMPOSE correlated subqueries. */
const qb = new QueryBuilder();

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
 *    it longer and no safer. One such query is left in this file, and every
 *    remaining exception in the codebase is classified in
 *    `docs/drizzle-orm-migration-plan.md`.
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
  agentId: chatbots.agentId,
  // Read through the same workspace the chatbot is in, so a name can never be
  // borrowed from another tenant's agent even if a row were somehow mislinked.
  //
  // Composed with the builder, not written as one `sql` template: in a select
  // list with no join Drizzle renders an interpolated column without its table
  // name, so the correlation would collapse to `"id" = "agent_id"` against the
  // INNER table and match nothing.
  agentName: sql<string | null>`${qb
    .select({ name: agents.name })
    .from(agents)
    .where(and(eq(agents.id, chatbots.agentId), eq(agents.workspaceId, chatbots.workspaceId)))}`,
  appearance: chatbots.appearance,
  allowedDomains: chatbots.allowedDomains,
  embedKey: chatbots.embedKey,
  createdAt: chatbots.createdAt,
  updatedAt: chatbots.updatedAt,
  conversationCount: sql<number>`${qb
    .select({ c: sql`count(*)` })
    .from(conversations)
    .where(eq(conversations.chatbotId, chatbots.id))}`.mapWith(Number),
  collectionIds: sql<string[] | null>`${qb
    .select({ ids: sql`array_agg(${chatbotCollections.collectionId})` })
    .from(chatbotCollections)
    .where(eq(chatbotCollections.chatbotId, chatbots.id))}`,
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
  agentId: string | null;
  agentName: string | null;
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
    agentId: row.agentId,
    agentName: row.agentName,
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
    agentId: chatbot.agentId,
    agentName: chatbot.agentName,
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
  /** `null` unlinks the agent and returns the chatbot to its own configuration. */
  agentId?: string | null;
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
  if (patch.agentId !== undefined) values.agentId = patch.agentId;
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

/**
 * The chatbots currently deploying an agent.
 *
 * Asked before an agent is archived or deleted, so the refusal can name what is
 * still using it instead of surfacing a foreign-key violation. Lives here
 * because it is a question about chatbots; `agent-service.ts` is the caller.
 */
export async function findChatbotsDeployingAgent(
  workspaceId: string,
  agentId: string,
  client?: PoolClient,
): Promise<Array<{ id: string; name: string; status: ChatbotStatus }>> {
  return withDb(
    (db) =>
      db
        .select({ id: chatbots.id, name: chatbots.name, status: chatbots.status })
        .from(chatbots)
        .where(and(eq(chatbots.workspaceId, workspaceId), eq(chatbots.agentId, agentId)))
        .orderBy(chatbots.name),
    client,
  );
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
        sourceCount: sql<number>`${qb
          .select({ c: sql`count(*)` })
          .from(knowledgeSources)
          .where(eq(knowledgeSources.collectionId, knowledgeCollections.id))}`.mapWith(Number),
        attached: sql<boolean>`EXISTS ${qb
          .select({ one: sql`1` })
          .from(chatbotCollections)
          .where(
            and(eq(chatbotCollections.collectionId, knowledgeCollections.id), eq(chatbotCollections.chatbotId, chatbotId)),
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
 * The four window counts are left as raw SQL on purpose: four correlated
 * date-window aggregates in one round trip. A query builder would turn that
 * into more code producing the same string, and the string is the part worth
 * reading. The recent conversations beside them are an ordinary read and go
 * through Drizzle.
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
        .where(and(eq(conversations.workspaceId, workspaceId), eq(conversations.chatbotId, chatbotId)))
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
