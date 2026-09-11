import { customType, pgEnum } from "drizzle-orm/pg-core";

/**
 * Shared column types and enums.
 *
 * This directory describes the database that ALREADY EXISTS. It is a typing
 * layer, not a source of truth that can silently change production: every
 * definition here was transcribed from `src/server/db/migrations/*.sql` and is
 * asserted against the live database by `tests/unit/schema-drift.test.ts`.
 *
 * Read `src/server/db/schema/index.ts` before editing anything here.
 */

/**
 * `citext` is a PostgreSQL extension type, so Drizzle has no builtin for it.
 * Case-insensitive comparison happens in the database; to TypeScript it is a
 * string like any other.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return "citext";
  },
});

export const memberRole = pgEnum("member_role", ["owner", "admin", "member", "viewer"]);

export const knowledgeBaseStatus = pgEnum("knowledge_base_status", ["empty", "processing", "ready", "error"]);
export const knowledgeSourceType = pgEnum("knowledge_source_type", ["url", "file", "text"]);
export const knowledgeSourceStatus = pgEnum("knowledge_source_status", [
  "pending",
  "ingesting",
  "processing",
  "chunking",
  "embedding",
  "indexing",
  "ready",
  "failed",
]);

export const chatbotStatus = pgEnum("chatbot_status", ["draft", "active", "paused", "archived"]);
export const agentStatus = pgEnum("agent_status", ["draft", "active", "paused", "archived"]);
export const workflowStatus = pgEnum("workflow_status", ["draft", "active", "paused", "archived"]);
export const workflowRunStatus = pgEnum("workflow_run_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "waiting_approval",
]);

export const contactStage = pgEnum("contact_stage", ["lead", "prospect", "customer", "churned"]);

export const conversationChannel = pgEnum("conversation_channel", ["widget", "playground", "api", "agent"]);
export const conversationStatus = pgEnum("conversation_status", ["open", "resolved", "escalated"]);
export const messageRole = pgEnum("message_role", ["user", "assistant", "system", "tool"]);

export const integrationStatus = pgEnum("integration_status", ["connected", "disconnected", "error"]);
