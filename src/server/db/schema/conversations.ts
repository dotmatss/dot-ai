import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { agents, chatbots } from "@/server/db/schema/chatbots";
import { conversationChannel, conversationStatus, messageRole } from "@/server/db/schema/columns";
import { contacts } from "@/server/db/schema/crm";
import { users } from "@/server/db/schema/identity";
import { workspaces } from "@/server/db/schema/tenancy";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    chatbotId: uuid("chatbot_id").references(() => chatbots.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    channel: conversationChannel("channel").notNull().default("widget"),
    status: conversationStatus("status").notNull().default("open"),
    title: text("title"),
    messageCount: integer("message_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Team member responsible for the thread. Nulled when the user is deleted. */
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    index("conversations_workspace_idx").on(table.workspaceId, table.lastMessageAt.desc().nullsLast()),
    index("conversations_chatbot_idx").on(table.chatbotId),
    index("conversations_contact_idx").on(table.contactId),
    index("conversations_workspace_status_idx").on(table.workspaceId, table.status, table.lastMessageAt.desc().nullsLast()),
    index("conversations_assigned_to_idx")
      .on(table.assignedTo)
      .where(sql`${table.assignedTo} IS NOT NULL`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    sources: jsonb("sources"),
    toolCalls: jsonb("tool_calls"),
    usage: jsonb("usage"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Set when a team member replies from the inbox. Human replies keep
     * role = 'assistant' so model context stays coherent; the UI renders them
     * as "Team" whenever this is present.
     */
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [index("messages_conversation_idx").on(table.conversationId, table.createdAt)],
);
