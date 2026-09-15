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

/**
 * Organization lifecycle, owned by the PLATFORM plane (migration 0023).
 * `suspended` is reversible; `disabled` is terminal. Neither deletes data.
 */
export const organizationStatus = pgEnum("organization_status", ["active", "suspended", "disabled"]);

export const collectionStatus = pgEnum("collection_status", ["empty", "processing", "ready", "error"]);
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
export const agentExecutionStatus = pgEnum("agent_execution_status", [
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "refused",
]);
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

/**
 * How a conversation ended, as Conversation Intelligence reads it (0027).
 *
 * Distinct from `conversation_status`, which is what a team member set. This is
 * derived from what actually happened in the thread: `handed_off` means a human
 * replied, and it outranks the others because a human reply is the fact that
 * decides whether the assistant contained the conversation.
 */
export const conversationOutcome = pgEnum("conversation_outcome", [
  "contained",
  "handed_off",
  "escalated",
  "unresolved",
]);

export const analysisRunStatus = pgEnum("analysis_run_status", ["running", "succeeded", "failed"]);

export const integrationStatus = pgEnum("integration_status", ["connected", "disconnected", "error"]);

/**
 * How an outbound credential turns into a request header (migration 0026).
 *
 * `bearer` and `basic` name their own header (`Authorization`); `header` is the
 * escape hatch for APIs that want their token somewhere else, and is the only
 * kind that carries a `header_name`.
 */
export const credentialType = pgEnum("credential_type", ["bearer", "header", "basic"]);

/**
 * The platform AI catalogue's vocabulary (migration 0024).
 *
 * `aiCapability` describes what a COMPLETION model can do. Embeddings are
 * absent on purpose: they carry a dimension count that must match stored
 * vectors, so they have their own registry rather than a capability flag.
 */
export const aiProviderKind = pgEnum("ai_provider_kind", [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "azure_openai",
  "gateway",
  "custom",
]);

export const aiCapability = pgEnum("ai_capability", [
  "chat",
  "agent",
  "tool_calling",
  "structured_output",
  "vision",
  "reranking",
]);

export const aiModelStatus = pgEnum("ai_model_status", ["active", "deprecated", "disabled"]);

/**
 * Where a workspace's plan assignment stands (migration 0028).
 *
 * `canceled` keeps the American spelling the rest of the billing vocabulary
 * uses; it means the assignment has been ended, not that the row is gone.
 * Absence of a row is a different state entirely - unassigned - and is
 * deliberately not represented here, because a workspace that nobody has put
 * on a plan has no subscription to give a status to.
 */
export const subscriptionStatus = pgEnum("subscription_status", ["active", "trialing", "past_due", "canceled"]);
