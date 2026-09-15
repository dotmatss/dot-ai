import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { agentStatus, chatbotStatus } from "@/server/db/schema/columns";
import { users } from "@/server/db/schema/identity";
import { knowledgeCollections } from "@/server/db/schema/knowledge";
import { workspaces } from "@/server/db/schema/tenancy";

/**
 * Agents and chatbots.
 *
 * An agent is the AI worker (instructions, model, tools, knowledge); a chatbot
 * is a channel it can be deployed on. `agents` is declared first because
 * `chatbots.agent_id` references it - see migration 0020.
 */

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
    /**
     * Dynamic delegation. An agent with this may hand a task to explicitly
     * granted agents in the same workspace while it runs - a capability, not a
     * subclass or a separate entity. See migration 0021 and `agent_delegations`.
     */
    canDelegate: boolean("can_delegate").notNull().default(false),
    /**
     * Per-agent delegation limits. Untrusted like any jsonb column: parsed and
     * clamped to hard ceilings by `delegationConfigSchema` on every read.
     */
    delegationConfig: jsonb("delegation_config").notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agents_workspace_id_idx").on(table.workspaceId, table.updatedAt.desc()),
    /**
     * Redundant with the primary key by construction. It exists so that
     * `chatbots (agent_id, workspace_id)` has a unique key to reference, which
     * is what makes a cross-workspace link unrepresentable rather than merely
     * rejected by application code. See migration 0020.
     */
    unique("agents_id_workspace_id_key").on(table.id, table.workspaceId),
  ],
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
    /**
     * Legacy/standalone AI configuration, used when `agentId` is null. Kept for
     * every chatbot that is not agent-backed, and as the configuration a
     * chatbot falls back to if it is later unlinked. See migration 0020.
     */
    instructions: text("instructions").notNull().default(""),
    welcomeMessage: text("welcome_message").notNull().default("Hi! How can I help you today?"),
    modelConfig: jsonb("model_config").notNull().default({}),
    /**
     * The agent this chatbot deploys, or null for a standalone chatbot. The
     * foreign key below is composite so it can only ever name an agent in this
     * chatbot's own workspace.
     */
    agentId: uuid("agent_id"),
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
    /**
     * Tenant boundary in the database. `ON DELETE RESTRICT` so deleting an
     * agent cannot silently change what a live deployment says; the service
     * turns the violation into a 409 naming the chatbots still using it.
     */
    foreignKey({
      name: "chatbots_agent_id_workspace_id_fkey",
      columns: [table.agentId, table.workspaceId],
      foreignColumns: [agents.id, agents.workspaceId],
    }).onDelete("restrict"),
    index("chatbots_agent_id_idx")
      .on(table.agentId)
      .where(sql`${table.agentId} IS NOT NULL`),
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
