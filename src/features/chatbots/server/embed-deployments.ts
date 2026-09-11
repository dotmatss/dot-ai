import "server-only";

import type { ChatbotStatus } from "@/features/chatbots/types";
import { query } from "@/server/db/client";
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
 * area consumes it rather than writing its own SQL over another feature's
 * tables, so the embed rules stay owned in one place.
 */
export async function listEmbedDeployments(workspaceId: string): Promise<EmbedDeployment[]> {
  const rows = await query<{
    id: string;
    name: string;
    status: ChatbotStatus;
    embed_key: string;
    allowed_domains: string[] | null;
    widget_conversations: string;
    last_widget_message_at: Date | null;
  }>(
    `SELECT cb.id, cb.name, cb.status, cb.embed_key, cb.allowed_domains,
            coalesce(w.conversations, 0)::text AS widget_conversations,
            w.last_message_at AS last_widget_message_at
     FROM chatbots cb
     LEFT JOIN LATERAL (
       SELECT count(*) AS conversations, max(c.last_message_at) AS last_message_at
       FROM conversations c
       WHERE c.chatbot_id = cb.id AND c.channel = 'widget'
     ) w ON true
     WHERE cb.workspace_id = $1 AND cb.status <> 'archived'
     ORDER BY cb.updated_at DESC`,
    [workspaceId],
  );

  return rows.map((row) => ({
    chatbotId: row.id,
    name: row.name,
    status: row.status,
    embedKey: row.embed_key,
    allowedDomains: row.allowed_domains ?? [],
    widgetConversations: Number(row.widget_conversations),
    lastWidgetMessageAt: toIso(row.last_widget_message_at),
  }));
}
