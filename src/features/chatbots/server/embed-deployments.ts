import "server-only";

import { and, desc, eq, ne, sql } from "drizzle-orm";

import type { ChatbotStatus } from "@/features/chatbots/types";
import { withDb } from "@/server/db/client";
import { chatbots, conversations } from "@/server/db/schema";
import { toIso } from "@/server/db/sql";

export interface EmbedDeployment {
  chatbotId: string;
  name: string;
  status: ChatbotStatus;
  embedKey: string;
  allowedDomains: string[];
  widgetConversations: number;
  lastWidgetMessageAt: string | null;
}

/**
 * Read model for the developer area's embed overview: which chatbots are
 * actually reachable from a website, and from which domains.
 *
 * It lives in the chatbots feature because it is chatbot data. The developer
 * area consumes it rather than writing its own query over another feature's
 * tables, so the embed rules stay owned in one place.
 */
export async function listEmbedDeployments(workspaceId: string): Promise<EmbedDeployment[]> {
  const rows = await withDb((db) => {
    // Both widget figures come from one correlated pass over the chatbot's
    // conversations, which is what the lateral join buys over two subqueries.
    const widget = db
      .select({
        conversations: sql<number>`count(*)`.as("conversations"),
        lastMessageAt: sql<Date | null>`max(${conversations.lastMessageAt})`.as("last_message_at"),
      })
      .from(conversations)
      .where(and(eq(conversations.chatbotId, chatbots.id), eq(conversations.channel, "widget")))
      .as("w");

    return db
      .select({
        id: chatbots.id,
        name: chatbots.name,
        status: chatbots.status,
        embedKey: chatbots.embedKey,
        allowedDomains: chatbots.allowedDomains,
        widgetConversations: sql<number>`coalesce(${widget.conversations}, 0)`.mapWith(Number),
        lastWidgetMessageAt: widget.lastMessageAt,
      })
      .from(chatbots)
      .leftJoinLateral(widget, sql`true`)
      .where(and(eq(chatbots.workspaceId, workspaceId), ne(chatbots.status, "archived")))
      .orderBy(desc(chatbots.updatedAt));
  });

  return rows.map((row) => ({
    chatbotId: row.id,
    name: row.name,
    status: row.status,
    embedKey: row.embedKey,
    allowedDomains: row.allowedDomains ?? [],
    widgetConversations: row.widgetConversations,
    lastWidgetMessageAt: toIso(row.lastWidgetMessageAt),
  }));
}
