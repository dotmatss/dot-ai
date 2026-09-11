import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { agentStatus, chatbotStatus } from "@/server/db/schema/columns";
import { users } from "@/server/db/schema/identity";
import { knowledgeCollections } from "@/server/db/schema/knowledge";
import { workspaces } from "@/server/db/schema/tenancy";

export const chatbots = pgTable(
  "chatbots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: chatbotStatus("status").notNull().default("draft"),
    instructions: text("instructions").notNull().default(""),
    welcomeMessage: text("welcome_message").notNull().default("Hi! How can I help you today?"),
    modelConfig: jsonb("model_config").notNull().default({}),
    appearance: jsonb("appearance").notNull().default({}),
    /** Browser-facing control: which sites may load the widget. */
    allowedDomains: text("allowed_domains").array().notNull().default([]),
    /** Public identifier that appears in the embed snippet. Not a secret. */
    embedKey: text("embed_key").notNull().unique(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("chatbots_workspace_id_slug_key").on(table.workspaceId, table.slug),
    index("chatbots_workspace_id_idx").on(table.workspaceId, table.updatedAt.desc()),
  ],
);

/** Which collections a chatbot may retrieve from. */
export const chatbotCollections = pgTable(
  "chatbot_collections",
  {
    chatbotId: uuid("chatbot_id")
      .notNull()
      .references(() => chatbots.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.chatbotId, table.collectionId] })],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: agentStatus("status").notNull().default("draft"),
    instructions: text("instructions").notNull().default(""),
    modelConfig: jsonb("model_config").notNull().default({}),
    tools: jsonb("tools").notNull().default([]),
    memoryConfig: jsonb("memory_config").notNull().default({}),
    outputSchema: jsonb("output_schema"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agents_workspace_id_idx").on(table.workspaceId, table.updatedAt.desc())],
);

/** Which collections an agent may retrieve from. */
export const agentCollections = pgTable(
  "agent_collections",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.collectionId] })],
);
